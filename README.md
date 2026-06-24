# DakTak

Mobile browser prototype with a Vite/Three.js client and a Node.js WebSocket game server.

## Local run

```bash
npm install
npm run dev:net
```

Open the Vite URL from the terminal on devices in the same network.

## Production preview

```bash
npm install
npm run build
npm run preview:net
```

The web client runs through Vite preview. The game room server listens on port `3001`.
