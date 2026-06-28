const axios = require('axios');
const { getPageSpeedApiKey } = require('../../config/seoConfig');

function mapMetricStatus(id, value) {
  if (value == null || Number.isNaN(value)) {
    return 'unknown';
  }
  if (id === 'lcp') {
    if (value <= 2500) return 'good';
    if (value <= 4000) return 'needs_improvement';
    return 'poor';
  }
  if (id === 'fid' || id === 'inp') {
    if (value <= 100) return 'good';
    if (value <= 300) return 'needs_improvement';
    return 'poor';
  }
  if (id === 'cls') {
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs_improvement';
    return 'poor';
  }
  if (id === 'ttfb') {
    if (value <= 800) return 'good';
    if (value <= 1800) return 'needs_improvement';
    return 'poor';
  }
  return 'unknown';
}

function formatMetric(id, valueMs) {
  if (valueMs == null) {
    return { value: null, unit: id === 'cls' ? '' : 'ms', status: 'unknown', displayValue: '—' };
  }
  if (id === 'cls') {
    const v = Number(valueMs);
    return {
      value: v,
      unit: '',
      status: mapMetricStatus(id, v),
      displayValue: v.toFixed(3),
    };
  }
  const v = Math.round(Number(valueMs));
  return {
    value: v,
    unit: 'ms',
    status: mapMetricStatus(id, v),
    displayValue: `${v} ms`,
  };
}

async function fetchCoreWebVitals(pageUrl) {
  const apiKey = getPageSpeedApiKey();
  if (!apiKey) {
    return {
      source: 'unconfigured',
      lcp: formatMetric('lcp', null),
      fid: formatMetric('fid', null),
      cls: formatMetric('cls', null),
      ttfb: formatMetric('ttfb', null),
    };
  }

  const apiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const { data } = await axios.get(apiUrl, {
    params: { url: pageUrl, strategy: 'mobile', key: apiKey, category: 'performance' },
    timeout: 60000,
  });

  const audits = data?.lighthouseResult?.audits || {};
  const lcp = audits['largest-contentful-paint']?.numericValue;
  const cls = audits['cumulative-layout-shift']?.numericValue;
  const ttfb = audits['server-response-time']?.numericValue;
  const inp = audits['interaction-to-next-paint']?.numericValue
    || audits['max-potential-fid']?.numericValue;

  return {
    source: 'pagespeed',
    lcp: formatMetric('lcp', lcp),
    fid: formatMetric('fid', inp),
    cls: formatMetric('cls', cls),
    ttfb: formatMetric('ttfb', ttfb),
  };
}

module.exports = {
  fetchCoreWebVitals,
  formatMetric,
};
