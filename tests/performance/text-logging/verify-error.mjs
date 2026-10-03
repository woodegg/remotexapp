const url = process.env.P13_INPUT_URL || 'ws://127.0.0.1:39011/input';
const socket = new WebSocket(url);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once:true });
  socket.addEventListener('error', () => reject(new Error('input WebSocket failed')), { once:true });
});
const reply = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('text acknowledgement timeout')), 3000);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type !== 'text-ack' || message.id !== 9001) return;
    clearTimeout(timeout);
    resolve(message);
  });
});
socket.send(JSON.stringify({ type:'text', id:9001, value:'' }));
console.log(JSON.stringify(await reply));
socket.close();
