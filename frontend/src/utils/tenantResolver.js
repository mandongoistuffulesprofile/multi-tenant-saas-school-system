export const getActiveTenantSubdomain = () => {
  const hostname = window.location.hostname;

  // Localhost development fallback
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return new URLSearchParams(window.location.search).get('tenant') || 'demo';
  }

  const parts = hostname.split('.');
  if (parts.length >= 3) {
    return parts[0];
  }

  return 'demo';
};
