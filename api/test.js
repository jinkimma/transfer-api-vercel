// Minimal test function for Vercel
export default async function handler(req, res) {
  return res.status(200).json({ ok: true, test: 'works', v: '3' });
}
