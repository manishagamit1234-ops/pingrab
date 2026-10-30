export async function onRequest(context) {
  return new Response(JSON.stringify({ ok: true, service: 'pingrab', time: Math.floor(Date.now() / 1000) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
