import Resource from './resource';

export default (key, config, applicationConfig) => {
  let validation = Resource.isValid(config);

  if (!validation.isValid) {

    console.log('');
    for (let error of validation.errors) {
      console.log(error);
    }
    console.log('');

    throw new Error(`resource "${key}" is not valid`);
  }

  return new Resource(key, config, applicationConfig);
}
