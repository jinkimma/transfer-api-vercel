// Minimal test function for Vercel
module.exports = async function handler(req, res) {
  return res.status(200).json({ ok: true, test: 'works', v: '4' });
}
