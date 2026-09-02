import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function inlineEntryCss(): Plugin {
  return {
    name: 'shroom-inline-entry-css',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = bundle['index.html']
      if (!htmlAsset || htmlAsset.type !== 'asset') return

      let html = String(htmlAsset.source)
      const stylesheetPattern = /<link rel="stylesheet" crossorigin href="\/([^"]+\.css)">/g

      html = html.replace(stylesheetPattern, (linkTag, fileName: string) => {
        const cssAsset = bundle[fileName]
        if (!cssAsset || cssAsset.type !== 'asset') return linkTag

        const css = typeof cssAsset.source === 'string'
          ? cssAsset.source
          : new TextDecoder().decode(cssAsset.source)

        delete bundle[fileName]
        return `<style data-shroom-entry>${css}</style>`
      })

      htmlAsset.source = html
    },
  }
}

export default defineConfig({
  plugins: [react(), inlineEntryCss()],
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
  }
})
