import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        preserveSymlinks: true
    },
    server: {
        proxy: {
            '/socket.io': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true
            }
        }
    }
});
