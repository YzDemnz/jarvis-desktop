// Shared public identifier API: canonicalSKU remains the stable export.
function canonicalSKU(value) {
  return String(value).trim().toLowerCase();
}
module.exports = { canonicalSKU };
