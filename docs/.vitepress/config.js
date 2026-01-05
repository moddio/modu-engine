import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Modu Engine',
  description: 'Local-first multiplayer game engine. Play instantly, sync seamlessly.',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'API', link: '/engine-api' },
      { text: 'Examples', link: 'https://github.com/moddio/modu/tree/main/engine/examples' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Concepts', link: '/concepts' },
          { text: 'Game Lifecycle', link: '/game-lifecycle' }
        ]
      },
      {
        text: 'ECS',
        items: [
          { text: 'Entities', link: '/entities' },
          { text: 'Components', link: '/components' },
          { text: 'Systems', link: '/systems' }
        ]
      },
      {
        text: 'Plugins',
        items: [
          { text: 'Physics 2D', link: '/physics-2d' },
          { text: 'Canvas Renderer', link: '/canvas-renderer' },
          { text: 'Debug UI', link: '/debug-ui' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Engine API', link: '/engine-api' },
          { text: 'Determinism', link: '/determinism' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moddio/modu' }
    ],

    search: {
      provider: 'local'
    }
  }
})
