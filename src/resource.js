import { hasMagic, sync as globSync } from 'glob';

import cloneDeep from 'lodash/lang/cloneDeep';
import getter from 'lodash/object/get';
import isArray from 'lodash/lang/isArray';
import isString from 'lodash/lang/isString';
import uniq from 'lodash/array/uniq';

import isModule from 'is-node-module-exists';

import { posix as path} from 'path';

const { join } = path;

const joinUrl = (...agrs) => agrs.join('/')
  .replace(/[\/]+/g, '/')
  .replace(/\/\?/g, '?')
  .replace(/\/\#/g, '#')
  .replace(/\:\//g, '://');

const getName = path => /(.+(?:\/|\\))?(.+\..+)?/.exec(path)[2] || null;
const getLocation = path => path.replace(/[^(?:\/|\\)]+$/, '');

const eachPath = (src, cb) => {
  let paths = null;

  if (isArray(src)) {
    paths = src;
  } else {
    paths = [src];
  }

  for (let path of paths) {
    let collected = globSync(path, {
      nosort: true
    });

    if (!collected.length) {
      if (isModule(path)) {
        collected = [path];
      }
    } else {
      collected = collected.map((script) => './' + script);
    }

    cb(collected, path);
  }
};

const collectWrongSrc = (src) => {
  let problems = [];
  let errors = [];

  eachPath(src, (collected, path) => {
    if (!collected.length) {
      try {
        require.resolve(path);
      } catch (e) {
        problems.push(path);
      }
    }
  });

  return {errors, problems};
};


const collectScripts = (src) => {
  let scripts = [];

  eachPath(src, (collected, path) => {
    if (collected.length) {
      scripts = scripts.concat(collected);
    }
  });

  return scripts;
};



const normalize = (key, config) => {
  let normalized = {
    originalArraySource: false
  };

  if (isArray(config.src)) {
    normalized.src = config.src;
    normalized.originalArraySource = true;
  } else {
    normalized.src = [config.src];
  }

  if (config.dest) {
    if (!isString(config.dest)) {
      throw new Error(`Wrong configuration for "${key}" resource: "dest" should be string`);
    }

    normalized.dest = config.dest;
  } else {
    if (!normalized.originalArraySource && !hasMagic(config.src)) {
      normalized.dest = config.src;
    } else {
      throw new Error(`Wrong configuration for "${key}" resource: "dest" is not defined and could not calculated`);
    }
  }

  normalized.target = getLocation(normalized.dest);
  normalized.destName = getName(normalized.dest);

  //normalized.names = normalized.src.map(path => getName(path));

  //let locations = normalized.src.map(path => getLocation(path));
  //normalized.locations = uniq(locations);

  if (config.mask) {
    if (isArray(config.mask)) {
      normalized.mask = config.mask;
    } else {
      normalized.mask = [config.mask];
    }
  } else {
    normalized.mask = null;
  }

  return normalized;
};


const validate = (config) => {
  let errors = [];

  if (!config.src) {
    errors.push('"src" is required option');
  }

  if (config.dest) {
    if (!isString(config.dest)) {
      errors.push('"dest" should be string');
    }
  } else {
    if (isArray(config.src)) {
      errors.push('"dest" is not defined and could not calculated because "src" is array');
    }
  }

  return errors;
};

let _normalized = Symbol('config');
let _key = Symbol('key');

let _applicationSrc = Symbol('application-src');
let _applicationDest = Symbol('application-dest');


let problemsLogged = new Set();

export default class Resource {
  constructor(key, config, applicationConfig) {
    this[_key] = key;
    this[_applicationSrc] = applicationConfig.src;
    this[_applicationDest] = applicationConfig.dest;
    this[_normalized] = normalize(key, config);

    let src = this.getSrc();

    if (!problemsLogged.has(key)) {
      let wrong = collectWrongSrc(src);

      if (wrong.problems.length) {
        console.log('');
        console.log(`Resource "${key}". There are path patterns for which no files were found`);
        for (let path of wrong.problems) {
          console.log(` - ${path}`)
        }
        console.log('----------');
        console.log('');

        problemsLogged.add(key);
      }
    }

    this[_normalized].collected = collectScripts(src);
  }

  static isValid(config = {}) {
    let errors = validate(config);

    return {
      errors,
      isValid: !errors.length
    }
  }

  // ---

  // returns src that is described at config concatenated with application src
  getSrc() {
    let src = this.getOriginalSrc();
    let applicationSrc = this[_applicationSrc];

    let resourceSrc = null;

    if (isArray(src)) {
      resourceSrc = src.map(path => {
        let normalized = null;

        if (isModule(path)) {
          normalized = path;
        } else {
          normalized = join(applicationSrc, path)
        }

        return normalized;
      });
    } else {
      if (isModule(src)) {
        resourceSrc = src;
      } else {
        resourceSrc = join(applicationSrc, src);
      }
    }

    return resourceSrc;
  }

  // returns all collected scripts via patterns that are described at config
  getCollected() {
    let collected = this.collected;
    if (!collected) {
      let src = this.getSrc();
      this.collected = collectScripts(src);
    }

    return this.collected;
  }

  // not useful
  getRelativeCollected() {
    let applicationSrc = this[_applicationSrc];
    let collected = this.getCollected();

    return collected.map(path => replace(`./${applicationSrc}`, ''));
  }

  // returns src that is described at config
  getOriginalSrc() {
    let normalized = this[_normalized];

    let relativeSrc = null;
    if (normalized.originalArraySource) {
      relativeSrc = normalized.src;
    } else {
      relativeSrc = normalized.src[0];``
    }

    return relativeSrc;
  }

  // -----

  // TODO:
  // returns dest that is described at config concatenated with application dest
  getDest() {
    let dest = this.getOriginalDest();
    let applicationDest = this[_applicationDest];

    return `./${join(applicationDest, dest)}`;
  }

  // returns dest that is described at config
  getOriginalDest() {
    let normalized = this[_normalized];
    return normalized.dest;
  }

  // returns mask option if defined. if not - returns src
  getMask() {
    let normalized = this[_normalized];
    let mask = null;

    if (normalized.mask) {
      let src = this[_applicationSrc];
      mask = normalized.mask.map(path => join(src, path));
    } else {
      mask = this.getSrc();
    }

    return mask;
  }

  getUrl() {
    let relativeTarget = this.getRelativeTarget();
    let destName = this.getDestName();

    let urls = null;
    if (destName) {
      urls = joinUrl('/', relativeTarget, destName);
    } else {
      let names = this.getName();

      urls = [];
      for (let name of names) {
        let url = joinUrl('/', relativeTarget, name);
        urls.push(url);
      }
    }

    return urls;
  }

  // is src is array - returns filtered array of names
  getName() {
    let normalized = this[_normalized];
    let collected = this.getCollected();

    let names = collected
        .map(path => {
          let modulePath = null;

          if (isModule(path)) {
            modulePath = isModule.resolve(path);
          } else {
            modulePath = path;
          }

          return getName(modulePath);
        })
        .filter(name => !!name);

    if (!names.length) {
      names = null;
    } else if (!normalized.originalArraySource) {
      names = names[0];
    }

    return names;
  }

  getDestName() {
    let normalized = this[_normalized];
    return normalized.destName;
  }

  hasDestName() {
    let normalized = this[_normalized];
    return !!normalized.destName;
  }

  getLocation() {
    let normalized = this[_normalized];
    let relativeLocation = this.getRelativeLocation();
    let applicationSrc = this[_applicationSrc];

    let locations = null;
    if (normalized.originalArraySource) {
      locations = relativeLocation.map(path => {
        let location = null;

        if (path[0] == '/') {
          location = path;
        } else {
          location = `./${join( applicationSrc, path)}`;
        }

        return location;
      });
    } else {
      locations = join(src, relativeLocation);
    }

    return locations;
  }

  // not useful
  getRelativeLocation() {
    let normalized = this[_normalized];
    let applicationSrc = this[_applicationSrc];
    let collected = this.getCollected();

    let locations = collected
      .map(path => {
        let modulePath = null;

        if (isModule(path)) {
          modulePath = isModule.resolve(path);
        } else {
          modulePath = replace(`./${applicationSrc}`, '');
        }

        return getLocation(modulePath);
      })
      .filter(location => !!location);

    if (!locations.length) {
      locations = null;
    } else if (!normalized.originalArraySource) {
      locations = locations[0];
    }

    return locations;
  }

  getTarget() {
    let relativeTarget = this.getRelativeTarget();
    let applicationDest = this[_applicationDest];

    return `./${join(applicationDest, relativeTarget)}`;
  }

  getRelativeTarget() {
    let normalized = this[_normalized];
    return normalized.target;
  }
}
