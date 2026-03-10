import { defineConfig } from 'vitepress'

export default defineConfig({
    title: "LLM Observer",
    description: "Privacy-First, Local-Only LLM Cost Intelligence.",
    ignoreDeadLinks: true,
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Guide', link: '/guide/installation' },
            { text: 'CLI Reference', link: '/guide/cli' },
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
                text: 'Providers',
                items: [
                    { text: 'OpenAI', link: '/guide/openai' },
                    { text: 'Anthropic Claude', link: '/guide/anthropic' },
                    { text: 'Google Gemini', link: '/guide/google' },
                    { text: 'Mistral / Groq', link: '/guide/openai' },
                    { text: 'Local / Ollama', link: '/guide/openai' },
                ]
            },
            {
                text: 'Features',
                items: [
                    { text: 'Proxy Engine', link: '/features/proxy' },
                    { text: 'Dashboard', link: '/features/dashboard' },
                    { text: 'Budget Guards', link: '/features/budget-guards' },
                    { text: 'Desktop App', link: '/guide/desktop' },
                ]
            },
            {
                text: 'Reference',
                items: [
                    { text: 'CLI Reference', link: '/guide/cli' },
                    { text: 'vs Helicone / Portkey', link: '/guide/comparison' },
                ]
            }
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/Ranjitbehera0034/llm-observer' }
        ]
    }
})
