import { useEffect, useRef, useState } from 'react'
import './App.css'

function App() {
  return (
    <div className="min-h-screen bg-void text-text-main relative">
      <div className="crt-overlay" />
      <Nav />
      <Hero />
      <Features />
      <Demo />
      <Install />
      <Footer />
    </div>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-void/90 backdrop-blur-md border-b border-border-dim' : ''}`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-crt-green/10 border border-crt-green/30 rounded flex items-center justify-center">
            <span className="font-pixel text-[10px] text-crt-green">RC</span>
          </div>
          <span className="font-pixel text-sm text-crt-green glow-green group-hover:text-crt-cyan transition-colors">ROOKIE CODE</span>
        </a>
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-text-dim hover:text-crt-green transition-colors">特性</a>
          <a href="#demo" className="text-sm text-text-dim hover:text-crt-green transition-colors">演示</a>
          <a href="#install" className="text-sm text-text-dim hover:text-crt-green transition-colors">安装</a>
          <a href="https://github.com/ljwrookie/rookie_code" target="_blank" rel="noreferrer" className="text-sm px-4 py-2 border border-crt-green/30 text-crt-green hover:bg-crt-green/10 transition-all">
            GitHub
          </a>
        </div>
      </div>
    </nav>
  )
}

function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = canvas.width = canvas.offsetWidth
    let h = canvas.height = canvas.offsetHeight

    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'
    const fontSize = 14
    const columns = Math.floor(w / fontSize)
    const drops: number[] = Array(columns).fill(1)

    function draw() {
      if (!ctx) return
      ctx.fillStyle = 'rgba(10, 10, 15, 0.05)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#00ff41'
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)]
        ctx.fillText(text, i * fontSize, drops[i] * fontSize)
        if (drops[i] * fontSize > h && Math.random() > 0.975) {
          drops[i] = 0
        }
        drops[i]++
      }
    }

    const interval = setInterval(draw, 35)

    const onResize = () => {
      w = canvas.width = canvas.offsetWidth
      h = canvas.height = canvas.offsetHeight
    }
    window.addEventListener('resize', onResize)

    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden grid-bg">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-30" />
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-crt-green/5 border border-crt-green/20 rounded-full mb-8">
          <span className="w-2 h-2 bg-crt-green rounded-full animate-pulse" />
          <span className="text-xs text-crt-green font-mono">v0.1.1 已发布</span>
        </div>

        <h1 className="font-pixel text-3xl md:text-5xl lg:text-6xl leading-tight mb-6">
          <span className="text-crt-green glow-green">ROOKIE</span>
          <br />
          <span className="text-text-main">CODE_</span>
          <span className="text-crt-cyan glow-cyan cursor-blink" />
        </h1>

        <p className="text-lg md:text-xl text-text-dim max-w-2xl mx-auto mb-10 leading-relaxed">
          基于 LLM 的终端代码智能体
          <br className="hidden md:block" />
          通过自然语言完成代码阅读、编辑、搜索、命令执行与多 Agent 协作
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a href="#install" className="group relative px-8 py-4 bg-crt-green/10 border border-crt-green/40 text-crt-green font-mono text-sm hover:bg-crt-green/20 transition-all">
            <span className="absolute inset-0 bg-crt-green/5 translate-x-1 translate-y-1 -z-10 group-hover:translate-x-2 group-hover:translate-y-2 transition-transform" />
            {'>'} npm install -g rookie-code
          </a>
          <a href="#demo" className="px-8 py-4 border border-border-dim text-text-dim font-mono text-sm hover:border-crt-amber hover:text-crt-amber transition-all">
            查看演示 ↓
          </a>
        </div>

        <div className="mt-20 grid grid-cols-3 gap-8 max-w-lg mx-auto">
          {[
            { label: 'Agent', value: 'Multi' },
            { label: 'Models', value: 'Claude/GPT' },
            { label: 'Runtime', value: 'Node.js 20+' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-pixel text-lg text-crt-amber glow-amber">{stat.value}</div>
              <div className="text-xs text-text-dim mt-1 font-mono">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-void to-transparent" />
    </section>
  )
}

function Features() {
  const features = [
    {
      icon: '⌨️',
      title: '自然语言驱动',
      desc: '用中文或英文描述需求，AI 自动完成代码阅读、编辑、搜索与命令执行',
      color: 'text-crt-green',
    },
    {
      icon: '🤖',
      title: '多 Agent 协作',
      desc: '支持 agent、multiagent、orchestrate 多种模式，复杂任务分解并行处理',
      color: 'text-crt-cyan',
    },
    {
      icon: '🧩',
      title: 'MCP & Skills',
      desc: '挂载 MCP tools 扩展能力，Skills 系统让 Agent 掌握专业领域知识',
      color: 'text-crt-amber',
    },
    {
      icon: '🧠',
      title: '长期记忆',
      desc: '自动维护仓库概览与上下文记忆，越用越懂你的代码库',
      color: 'text-crt-pink',
    },
    {
      icon: '🛡️',
      title: '安全机制',
      desc: 'Prompt injection 基础防护、路径沙箱、命令执行确认，多重安全保障',
      color: 'text-crt-red',
    },
    {
      icon: '🔌',
      title: 'VS Code 扩展',
      desc: '配合扩展自动注入编辑器上下文，当前文件与选区一键同步',
      color: 'text-crt-green',
    },
  ]

  return (
    <section id="features" className="py-32 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-20">
          <span className="font-mono text-xs text-crt-amber tracking-widest">// FEATURES</span>
          <h2 className="font-pixel text-2xl md:text-3xl mt-4 mb-4">能力矩阵</h2>
          <p className="text-text-dim max-w-xl mx-auto">从单文件编辑到多 Agent 协作，覆盖开发工作流的每个环节</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="group p-6 bg-void-light border border-border-dim hover:border-crt-green/30 transition-all duration-300 hover:-translate-y-1"
            >
              <div className="text-2xl mb-4">{f.icon}</div>
              <h3 className={`font-mono text-sm font-bold mb-2 ${f.color}`}>{f.title}</h3>
              <p className="text-sm text-text-dim leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Demo() {
  const [lines, setLines] = useState<string[]>([])
  const fullLines = [
    { text: '$ rookie-code', color: 'text-crt-green' },
    { text: 'Rookie Code v0.1.1 — 终端代码智能体已启动', color: 'text-text-dim' },
    { text: '模型: claude-sonnet-4-6 | 提供商: anthropic', color: 'text-text-dim' },
    { text: '', color: '' },
    { text: '你可以:', color: 'text-crt-amber' },
    { text: '  • 描述需求让我修改代码', color: 'text-text-main' },
    { text: '  • 问我关于代码库的问题', color: 'text-text-main' },
    { text: '  • 执行 shell 命令或运行测试', color: 'text-text-main' },
    { text: '  • 使用 /agent /multiagent /orchestrate 切换模式', color: 'text-text-main' },
    { text: '', color: '' },
    { text: '> 帮我优化这个函数的性能', color: 'text-crt-cyan' },
    { text: '正在分析 src/utils/parser.ts...', color: 'text-text-dim' },
    { text: '发现 3 处可优化点:', color: 'text-crt-amber' },
    { text: '  1. 正则表达式可预编译', color: 'text-text-main' },
    { text: '  2. 循环内重复计算可提取', color: 'text-text-main' },
    { text: '  3. 大数据集建议改用流式处理', color: 'text-text-main' },
    { text: '', color: '' },
    { text: '已生成优化补丁，是否应用？ [Y/n]', color: 'text-crt-green' },
  ]

  useEffect(() => {
    let i = 0
    const timer = setInterval(() => {
      if (i < fullLines.length) {
        setLines((prev) => [...prev, fullLines[i].text])
        i++
      } else {
        clearInterval(timer)
      }
    }, 180)
    return () => clearInterval(timer)
  }, [])

  const terminalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines])

  return (
    <section id="demo" className="py-32 relative bg-void-light/30">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs text-crt-cyan tracking-widest">// DEMO</span>
          <h2 className="font-pixel text-2xl md:text-3xl mt-4 mb-4">交互演示</h2>
          <p className="text-text-dim">真实的终端交互体验，自然语言驱动开发</p>
        </div>

        <div className="terminal-window">
          <div className="flex items-center gap-2 px-4 py-3 bg-void-light border-b border-border-dim">
            <div className="w-3 h-3 rounded-full bg-crt-red/60" />
            <div className="w-3 h-3 rounded-full bg-crt-amber/60" />
            <div className="w-3 h-3 rounded-full bg-crt-green/60" />
            <span className="ml-4 text-xs text-text-dim font-mono">rookie-code — zsh</span>
          </div>
          <div ref={terminalRef} className="p-6 h-96 overflow-y-auto font-mono text-sm">
            {lines.map((line, i) => (
              <div key={i} className={`${fullLines[i]?.color || 'text-text-main'} leading-6`}>
                {line}
                {i === lines.length - 1 && i < fullLines.length - 1 && (
                  <span className="inline-block w-2 h-4 bg-crt-green ml-1 animate-pulse" />
                )}
              </div>
            ))}
            {lines.length >= fullLines.length && (
              <div className="text-crt-green mt-2">
                <span className="animate-pulse">█</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Install() {
  const steps = [
    { cmd: 'npm install -g rookie-code', desc: '全局安装 CLI' },
    { cmd: 'export ANTHROPIC_API_KEY=xxx', desc: '配置模型 API Key' },
    { cmd: 'rookie-code', desc: '启动智能体' },
  ]

  const [copied, setCopied] = useState<number | null>(null)
  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopied(idx)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <section id="install" className="py-32 relative">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="font-mono text-xs text-crt-green tracking-widest">// QUICK START</span>
          <h2 className="font-pixel text-2xl md:text-3xl mt-4 mb-4">快速开始</h2>
          <p className="text-text-dim">三步启动你的终端代码智能体</p>
        </div>

        <div className="space-y-6">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-6 group">
              <div className="flex-shrink-0 w-10 h-10 bg-crt-green/10 border border-crt-green/30 flex items-center justify-center font-pixel text-xs text-crt-green">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="flex-1">
                <p className="text-sm text-text-dim mb-2">{step.desc}</p>
                <div className="relative bg-terminal border border-border-dim rounded p-4 font-mono text-sm text-crt-green group-hover:border-crt-green/30 transition-colors">
                  <code>{step.cmd}</code>
                  <button
                    onClick={() => copy(step.cmd, i)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-dim hover:text-crt-green transition-colors"
                  >
                    {copied === i ? '已复制!' : '复制'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 p-6 bg-crt-amber/5 border border-crt-amber/20 rounded">
          <div className="flex items-start gap-4">
            <span className="text-crt-amber text-xl">💡</span>
            <div>
              <h4 className="font-mono text-sm text-crt-amber mb-2">提示</h4>
              <p className="text-sm text-text-dim leading-relaxed">
                也支持 OpenAI、ARK 等 OpenAI-compatible 接口。可通过 <code className="text-crt-green bg-terminal px-1 rounded">--provider</code> 和 <code className="text-crt-green bg-terminal px-1 rounded">--base-url</code> 参数灵活切换。
                配合 VS Code 扩展使用，可自动注入编辑器上下文。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="py-16 border-t border-border-dim">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-crt-green/10 border border-crt-green/30 rounded flex items-center justify-center">
              <span className="font-pixel text-[10px] text-crt-green">RC</span>
            </div>
            <span className="font-pixel text-xs text-text-dim">ROOKIE CODE</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="https://github.com/ljwrookie/rookie_code" target="_blank" rel="noreferrer" className="text-sm text-text-dim hover:text-crt-green transition-colors">
              GitHub
            </a>
            <a href="https://www.npmjs.com/package/rookie-code" target="_blank" rel="noreferrer" className="text-sm text-text-dim hover:text-crt-green transition-colors">
              npm
            </a>
            <a href="https://open-vsx.org/extension/rookie/rookie-code-vscode" target="_blank" rel="noreferrer" className="text-sm text-text-dim hover:text-crt-green transition-colors">
              VS Code 扩展
            </a>
          </div>

          <div className="text-xs text-text-dim font-mono">
            MIT License © 2026
          </div>
        </div>
      </div>
    </footer>
  )
}

export default App
