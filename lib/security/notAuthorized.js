function buildNotAuthorizedConfig(prevConfig = {}, details = {}) {
  return {
    persona: prevConfig.persona || 'unknown',
    params: {
      collectors: [],
      interpreters: [],
      responders: ['notAuthorized']
    },
    __license: { state: 'denied', ...details },
    security: { requireHttps: true }
  };
}

module.exports = { buildNotAuthorizedConfig };

