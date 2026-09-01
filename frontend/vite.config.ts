import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      '/rtc': {
        target: 'http://localhost:7880',
        ws: true,
        changeOrigin: true,
      },
      '/twirp': {
        target: 'http://localhost:7880',
        changeOrigin: true,
      },
    }
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@livekit/components-react')) {
            return 'livekit-react-vendor';
          }
          // Split out some heavy internal dependencies of livekit-client if possible
          if (id.includes('node_modules/protobufjs')) {
            return 'protobuf-vendor';
          }
          if (id.includes('node_modules/webrtc-adapter')) {
            return 'webrtc-adapter-vendor';
          }
          if (id.includes('node_modules/livekit-client')) {
            return 'livekit-core-vendor';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'framer-motion-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide-vendor';
          }
        }
      }
    }
  }
})
