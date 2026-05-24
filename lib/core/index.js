module.exports = {
  ...require('./loadConfig'),
  ...require('./verifyLicense'),
  ...require('./loadImplementation')
};

