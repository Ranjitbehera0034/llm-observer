import { defineConfig } from 'vitepress'

export default defineConfig({
    title: "LLM Observer",
    description: "Privacy-First, Local-Only LLM Cost Intelligence.",
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Guide', link: '/guide/installation' }
        ],
        sidebar: [
            {
                text: 'Introduction',
                items: [
                    { text: 'What is LLM Observer?', link: '/what-is-llm-observer' },
                    { text: 'Getting Started', link: '/guide/installation' }
                ]
            },
            {
                text: 'Features',
                items: [
                    { text: 'Proxy Engine', link: '/features/proxy' },
                    { text: 'Dashboard', link: '/features/dashboard' },
                    { text: 'Budget Guards', link: '/features/budget-guards' }
                ]
            }
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/Ranjitbehera0034/llm-observer' }
        ]
    }
})
