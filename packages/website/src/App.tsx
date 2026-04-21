import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'

function App() {
  useScrollReveal()
  useSpotlightEffect()

  return (
    <div className="min-h-screen relative">
      <div className="grid-bg" />
      <div className="scanlines" />
      <Nav />
      <Hero />
      <Stats />
      <Features />
      <Tools />
      <Capabilities />
      <Architecture />
      <QuickStart />
      <Footer />
    </div>
  )
}

type DemoLine = {
  text: string
  type: string
}

type DemoStep =
  | { kind: 'pause'; duration: number }
  | { kind: 'input'; text: string }
  | { kind: 'empty' }
  | { kind: 'instant_line'; line: DemoLine }
  | { kind: 'line'; line: DemoLine; speed?: number }

const HERO_STATIC_LINES: DemoLine[] = [
  { text: 'LLM: provider=anthropic, model=claude-sonnet-4-20250514', type: 'info' },
  { text: '使用提示：', type: 'label' },
  { text: '- 回车：发送（执行中会进入队列）', type: 'tip' },
  { text: '- Ctrl+J：插入换行（输入框内用 \\n 显示）', type: 'tip' },
  { text: '- Ctrl+C：运行中取消；空闲时退出', type: 'tip' },
  { text: '', type: 'empty' },
]

const HERO_DEMO_STEPS: DemoStep[] = [
  { kind: 'pause', duration: 700 },
  { kind: 'input', text: '帮我梳理 CLI 的 slash commands，先确认范围，再并行分析相关模块' },
  { kind: 'pause', duration: 180 },
  { kind: 'empty' },
  { kind: 'instant_line', line: { text: '🛠️ ask_user', type: 'tool' } },
  { kind: 'pause', duration: 140 },
  { kind: 'instant_line', line: { text: '需要你确认一些信息：', type: 'label' } },
  { kind: 'instant_line', line: { text: '? 本次范围（单选）', type: 'info' } },
  { kind: 'instant_line', line: { text: '  (*) 补齐全部 slash commands', type: 'success' } },
  { kind: 'instant_line', line: { text: '? 输出内容（多选）', type: 'info' } },
  { kind: 'instant_line', line: { text: '  [x] 实现方案  [x] 风险点  [x] 测试建议', type: 'success' } },
  { kind: 'pause', duration: 240 },
  { kind: 'instant_line', line: { text: '📦 tool_result ask_user: {"scope":"all_slash_commands","outputs":["implementation","risks","tests"]}', type: 'result' } },
  { kind: 'pause', duration: 220 },
  { kind: 'empty' },
  { kind: 'instant_line', line: { text: '🛠️ -> multiagent', type: 'tool' } },
  { kind: 'instant_line', line: { text: '🛠️   -> agent: 梳理 commands.ts 中现有 slash commands', type: 'tool' } },
  { kind: 'instant_line', line: { text: '🛠️   -> agent: 对齐 terminal-ui.ts 中欢迎提示与底栏文案', type: 'tool' } },
  { kind: 'instant_line', line: { text: '🛠️   -> agent: 汇总 README / CLI README 中用户可见命令说明', type: 'tool' } },
  { kind: 'pause', duration: 360 },
  { kind: 'instant_line', line: { text: '  <- agent done', type: 'success' } },
  { kind: 'pause', duration: 180 },
  { kind: 'instant_line', line: { text: '  <- agent done', type: 'success' } },
  { kind: 'pause', duration: 220 },
  { kind: 'instant_line', line: { text: '  <- agent done', type: 'success' } },
  { kind: 'instant_line', line: { text: '<- multiagent done', type: 'success' } },
  { kind: 'empty' },
  { kind: 'line', line: { text: 'DONE: 共发现 9 个 slash commands，/help 与 UI 提示存在 3 处不一致', type: 'success' }, speed: 20 },
  { kind: 'line', line: { text: 'FILES: packages/cli/src/cli/commands.ts, terminal-ui.ts, README.md', type: 'success' }, speed: 20 },
  { kind: 'pause', duration: 650 },
  { kind: 'empty' },
  { kind: 'input', text: '把这个任务切成 planner/worker，只输出计划，不直接改代码' },
  { kind: 'pause', duration: 180 },
  { kind: 'empty' },
  { kind: 'instant_line', line: { text: '🛠️ OK orchestrate', type: 'tool' } },
  { kind: 'instant_line', line: { text: 'Planner/worker 编排：先生成任务分解（JSON），再并行运行多个子 agent，最后汇总输出。', type: 'info' } },
  { kind: 'instant_line', line: { text: 'OK orchestrate(plan_only): 输出 3 个独立 worker 任务', type: 'success' } },
  { kind: 'instant_line', line: { text: '📦 1. commands.ts：补齐命令描述、示例与别名说明', type: 'result' } },
  { kind: 'instant_line', line: { text: '📦 2. terminal-ui.ts：对齐欢迎提示、底栏与状态显示', type: 'result' } },
  { kind: 'instant_line', line: { text: '📦 3. README.md / packages/cli/README.md：同步用户可见文档', type: 'result' } },
  { kind: 'empty' },
  { kind: 'line', line: { text: 'DONE: ask_user / multiagent / orchestrate 已联动演示，适合复杂代码任务拆解', type: 'prompt' }, speed: 20 },
]

const STATS_TARGETS = [10, 16, 3]
const STATS_LABELS = ['内置工具', 'Hook 事件', 'LLM 提供方']

/* ============ NAV ============ */
function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-8 h-16 transition-all duration-500 ${scrolled ? 'liquid-glass' : ''}`}>
      <a href="#" className="flex items-center gap-2 font-mono text-[1.2rem] font-bold text-green no-underline group">
        <span className="relative">
          Rookie
          <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-green group-hover:w-full transition-all duration-300" />
        </span>
        <span className="text-green">Code</span>
        <span className="inline-block w-[10px] h-5 bg-green animate-blink" />
      </a>
      <div className="hidden md:flex items-center gap-8">
        {['功能', '工具', '能力矩阵', '架构'].map((label) => (
          <a key={label} href={`#${label === '功能' ? 'features' : label === '工具' ? 'tools' : label === '能力矩阵' ? 'capabilities' : 'architecture'}`} className="font-mono text-[0.85rem] text-text-dim no-underline hover:text-green transition-colors relative group">
            {label}
            <span className="absolute -bottom-1 left-0 w-0 h-px bg-green group-hover:w-full transition-all duration-300" />
          </a>
        ))}
        <a href="#quickstart" className="font-mono text-[0.8rem] px-5 py-2 bg-transparent text-green border border-green rounded cursor-pointer no-underline hover:bg-green hover:text-bg-deep hover:shadow-[0_0_20px_rgba(0,255,136,0.3)] transition-all duration-300">
          快速开始
        </a>
      </div>
    </nav>
  )
}

/* ============ HERO ============ */
function Hero() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<DemoLine[]>(HERO_STATIC_LINES)

  // 3D tilt effect
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 })

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const rx = ((e.clientY - centerY) / 300) * -8
    const ry = ((e.clientX - centerX) / 300) * 8
    setTilt({ rx, ry })
  }

  const handleMouseLeave = () => {
    setTilt({ rx: 0, ry: 0 })
  }

  const [lines, setLines] = useState<DemoLine[]>(HERO_STATIC_LINES)
  const [composerText, setComposerText] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [streamingLineIndex, setStreamingLineIndex] = useState<number | null>(null)
  const [statusText, setStatusText] = useState('')

  useEffect(() => {
    let cancelled = false
    const timeoutIds: number[] = []

    const wait = (duration: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(resolve, duration)
        timeoutIds.push(id)
      })

    const typeIntoComposer = async (text: string) => {
      setStatusText('Composing prompt...')
      setIsComposing(true)
      setIsSending(false)
      setComposerText('')

      for (let i = 1; i <= text.length; i++) {
        await wait(42)
        if (cancelled) return
        setComposerText(text.slice(0, i))
      }

      await wait(220)
      if (cancelled) return

      setStatusText('Submitting prompt...')
      setIsSending(true)
      await wait(120)
      if (cancelled) return

      setLines((prev) => [...prev, { text: `> ${text}`, type: 'user' }])
      setComposerText('')
      setIsComposing(false)
      await wait(150)
      if (cancelled) return

      setIsSending(false)
      setStatusText('Streaming response...')
    }

    const typeLine = async (line: DemoLine, speed = 18) => {
      const nextIndex = linesRef.current.length
      setStreamingLineIndex(nextIndex)
      setLines((prev) => [...prev, { ...line, text: '' }])

      for (let i = 1; i <= line.text.length; i++) {
        await wait(speed)
        if (cancelled) return
        setLines((prev) => {
          const next = [...prev]
          next[next.length - 1] = { ...line, text: line.text.slice(0, i) }
          return next
        })
      }

      setStreamingLineIndex(null)
      await wait(line.type === 'thinking' ? 180 : 90)
    }

    const playDemo = async () => {
      setStatusText('Streaming demo...')

      for (const step of HERO_DEMO_STEPS) {
        if (cancelled) return

        if (step.kind === 'pause') {
          await wait(step.duration)
          continue
        }

        if (step.kind === 'input') {
          await typeIntoComposer(step.text)
          continue
        }

        if (step.kind === 'empty') {
          setStreamingLineIndex(null)
          setLines((prev) => [...prev, { text: '', type: 'empty' }])
          continue
        }

        if (step.kind === 'instant_line') {
          setStreamingLineIndex(null)
          setLines((prev) => [...prev, step.line])
          continue
        }

        await typeLine(step.line, step.speed)
      }

      if (!cancelled) {
        setStatusText('In packages/website/src/App.tsx')
      }
    }

    void playDemo()

    return () => {
      cancelled = true
      timeoutIds.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  useEffect(() => {
    linesRef.current = lines
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines, composerText])

  const getLineStyle = (type: string) => {
    switch (type) {
      case 'ascii': return 'text-cyan text-[0.75rem] leading-[1.3] whitespace-pre opacity-90'
      case 'info': return 'text-text-dim text-[0.8rem]'
      case 'label': return 'text-text text-[0.85rem] mt-2'
      case 'tip': return 'text-text-dim text-[0.8rem] pl-2'
      case 'user': return 'text-green text-[0.9rem]'
      case 'thinking': return 'text-text-dim text-[0.85rem]'
      case 'tool': return 'text-cyan text-[0.85rem]'
      case 'cmd': return 'text-text-dim text-[0.85rem]'
      case 'result': return 'text-text text-[0.85rem] pl-4'
      case 'success': return 'text-green text-[0.85rem]'
      case 'prompt': return 'text-green text-[0.9rem]'
      default: return 'text-text'
    }
  }

  const asciiArt = [
    '  ____             _    _         ____          _',
    ' |  _ \\ ___   ___ | | _(_) ___   / ___|___   __| | ___',
    ' | |_) / _ \\ / _ \\| |/ / |/ _ \\ | |   / _ \\ / _` |/ _ \\',
    ' |  _ < (_) | (_) |   <| |  __/ | |__| (_) | (_| |  __/',
    ' |_| \\_\\___/ \\___/|_|\\_\\_|\\___|  \\____\\___/ \\__,_|\\___|',
  ].join('\n')

  return (
    <section className="min-h-[100dvh] flex items-center pt-24 pb-16 px-6 relative overflow-hidden">
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(0,255,136,0.08)_0%,transparent_70%)] pointer-events-none" />
      <div className="absolute top-[30%] left-[40%] -translate-x-1/2 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(0,212,255,0.05)_0%,transparent_70%)] pointer-events-none" />

      <div className="max-w-[1200px] mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Left: Content */}
        <div className="text-left">
          <div
            className="inline-flex items-center gap-2 font-mono text-[0.75rem] tracking-[0.15em] text-cyan uppercase mb-6 px-4 py-1.5 border border-[rgba(0,212,255,0.3)] rounded-full bg-[rgba(0,212,255,0.05)] animate-fadeInUp"
          >
            <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse-dot" />
            开源 · MIT License
          </div>

          <h1
            className="font-mono text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold tracking-[-0.03em] leading-[1.1] mb-6 animate-fadeInUp"
            style={{ animationDelay: '0.15s' }}
          >
            <span className="relative inline-block">
              <span className="absolute inset-0 text-cyan animate-[glitch-1_3s_infinite_linear]" style={{ clipPath: 'inset(0 0 85% 0)' }}>Rookie</span>
              <span className="absolute inset-0 text-magenta animate-[glitch-2_3s_infinite_linear]" style={{ clipPath: 'inset(85% 0 0 0)' }}>Rookie</span>
              Rookie
            </span>
            <span className="text-green glow-green">&nbsp;Code</span>
          </h1>

          <p
            className="text-[clamp(1rem,2vw,1.15rem)] text-text-dim max-w-[520px] leading-[1.8] mb-8 animate-fadeInUp"
            style={{ animationDelay: '0.3s' }}
          >
            基于 <strong className="text-text font-medium">LLM</strong> 的终端代码智能体<br />
            通过自然语言完成<strong className="text-text font-medium">代码阅读、编辑、搜索、命令执行</strong>，以及<strong className="text-text font-medium">多 Agent 协作</strong>
          </p>

          <div
            className="flex gap-4 flex-wrap animate-fadeInUp"
            style={{ animationDelay: '0.45s' }}
          >
            <a href="#quickstart" className="group relative font-mono text-[0.9rem] font-semibold px-7 py-3 bg-green text-bg-deep rounded-md no-underline inline-flex items-center gap-2 overflow-hidden hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(0,255,136,0.4)] transition-all duration-300">
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              快速开始
            </a>
            <a href="https://github.com/ljwrookie/rookie_code" target="_blank" rel="noreferrer" className="font-mono text-[0.9rem] px-7 py-3 bg-transparent text-text border border-border rounded-md no-underline inline-flex items-center gap-2 hover:border-cyan hover:text-cyan hover:-translate-y-0.5 transition-all duration-300">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              查看源码
            </a>
          </div>
        </div>

        {/* Right: CLI Demo Terminal */}
        <div
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full animate-fadeInUp"
          style={{
            animationDelay: '0.3s',
            perspective: '1000px',
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transition: 'transform 0.15s ease-out',
          }}
        >
          <div className="bg-[#1e1e2e] rounded-lg overflow-hidden border border-[#2a2a3a] shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            {/* Header */}
            <div className="px-4 py-3 bg-[#252536] border-b border-[#2a2a3a] flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#28ca41]" />
              <span className="ml-3 text-[0.75rem] text-text-dim font-mono">rookie-code</span>
            </div>

            {/* Content */}
            <div ref={terminalRef} className="p-5 font-mono text-[0.85rem] leading-[1.7] min-h-[400px] max-h-[480px] overflow-y-auto">
              {/* ASCII Art */}
              <div className="text-cyan text-[0.75rem] leading-[1.3] whitespace-pre mb-3 opacity-90">
                {asciiArt}
              </div>

              {/* Lines */}
              {lines.map((line, i) => {
                if (line.type === 'empty') return <div key={i} className="h-4" />
                if (line.type === 'ascii') return null
                return (
                  <div key={i} className={getLineStyle(line.type)}>
                    {line.text}
                    {streamingLineIndex === i && (
                      <span className="demo-caret ml-1 align-middle" aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Input Box - always visible at bottom */}
            <div className="px-4 py-3 bg-[#1e1e2e] border-t border-[#2a2a3a]">
              <div className={`demo-composer flex items-start gap-2 bg-[#2a2a3a] rounded-md px-3 py-2.5 border border-[#3a3a4a] min-h-[48px] ${isSending ? 'is-sending' : ''}`}>
                <span className="text-green text-[1rem]">{'>'}</span>
                <div className="flex-1 min-w-0 pt-0.5">
                  {composerText ? (
                    <span className="text-green text-[0.9rem] whitespace-pre-wrap break-words">
                      {composerText}
                      <span className="demo-caret ml-0.5 align-[-0.1em]" aria-hidden="true" />
                    </span>
                  ) : isComposing ? (
                    <span className="demo-caret align-middle" aria-hidden="true" />
                  ) : (
                    <span className="text-text-dim text-[0.85rem]">
                      输入指令或自然语言描述...
                      <span className="demo-caret demo-caret--idle ml-2 align-middle" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <span className={`demo-enter-hint shrink-0 mt-0.5 ${isSending ? 'is-active' : ''}`}>
                  Enter
                </span>
              </div>
            </div>

            {/* Status Bar */}
            <div className="px-4 py-2 bg-[#252536] border-t border-[#2a2a3a]">
              <div className="flex items-center gap-4 text-[0.75rem] font-mono">
                {statusText && (
                  <>
                    <span className="text-orange">{statusText}</span>
                    <span className="text-text-dim">{'\\'} 续行 · / 命令 · Ctrl+C 取消</span>
                  </>
                )}
                {!statusText && (
                  <span className="text-text-dim">Tokens 总量 4 · 上下文 1633/100000 (2%) · 队列 0</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============ STATS ============ */
function Stats() {
  const statsRef = useRef<HTMLDivElement>(null)
  const [counts, setCounts] = useState([0, 0, 0])

  useEffect(() => {
    const el = statsRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          STATS_TARGETS.forEach((target, i) => {
            let current = 0
            const step = Math.max(1, Math.floor(target / 30))
            const timer = setInterval(() => {
              current += step
              if (current >= target) {
                current = target
                clearInterval(timer)
              }
              setCounts((prev) => {
                const next = [...prev]
                next[i] = current
                return next
              })
            }, 40)
          })
          observer.unobserve(el)
        }
      })
    }, { threshold: 0.5 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      ref={statsRef}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="flex justify-center gap-16 flex-wrap py-12 px-6 bg-bg border-y border-border"
    >
      {STATS_TARGETS.map((_, i) => (
        <div key={i} className="text-center">
          <div className="font-mono text-[2.2rem] font-extrabold text-green leading-none">{counts[i]}</div>
          <div className="text-[0.8rem] text-text-dim mt-1 font-mono">{STATS_LABELS[i]}</div>
        </div>
      ))}
      <div className="text-center">
        <div className="font-mono text-[2.2rem] font-extrabold text-green leading-none">TS</div>
        <div className="text-[0.8rem] text-text-dim mt-1 font-mono">100% TypeScript</div>
      </div>
    </motion.div>
  )
}

/* ============ FEATURES (Bento Grid) ============ */
function Features() {
  const features = [
    { icon: '🧠', title: '自然语言驱动', desc: '用中文或英文描述需求，LLM 理解意图后自动调用工具链完成任务' },
    { icon: '✏️', title: '精确代码编辑', desc: '基于字符串匹配的精确替换，改动可控可审查' },
    { icon: '🔍', title: '智能代码搜索', desc: '语义化搜索与目录浏览双管齐下' },
    { icon: '⚡', title: 'Shell 命令执行', desc: '安全执行 Shell 命令，高危操作自动确认' },
    { icon: '🤖', title: '多 Agent 协作', desc: '支持 agent、multiagent、orchestrate 三种模式' },
    { icon: '🧩', title: '插件与技能系统', desc: 'Skills + Hooks + MCP 三重扩展机制' },
    { icon: '💾', title: '长期记忆', desc: '跨会话保留项目上下文与偏好' },
    { icon: '🛡️', title: '安全防护', desc: 'Prompt injection 检测、路径校验、命令防护' },
    { icon: '🎨', title: '交互式终端 UI', desc: '流式输出、Token 预算、调试日志' },
  ]

  return (
    <section id="features" className="py-24 px-6 bg-gradient-to-b from-bg-deep to-bg">
      <div className="text-center mb-16 reveal">
        <div className="font-mono text-[0.7rem] tracking-[0.2em] text-green uppercase mb-3">// 核心功能</div>
        <h2 className="font-sans text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">用自然语言，驱动一切代码操作</h2>
        <p className="text-text-dim max-w-[560px] mx-auto mt-4 leading-[1.7] text-[1.05rem]">不只是代码补全 — Rookie Code 是你终端里的全能编程伙伴</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-[1100px] mx-auto">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="feature-card spotlight-card"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-[0.75rem] font-mono font-bold mb-4 bg-[rgba(0,255,136,0.08)] border border-[rgba(0,255,136,0.15)] text-green">
              {f.icon}
            </div>
            <h3 className="font-sans text-[1rem] font-semibold mb-2">{f.title}</h3>
            <p className="text-text-dim text-[0.85rem] leading-[1.6]">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ============ TOOLS ============ */
function Tools() {
  const tools = [
    { name: 'read_file', desc: '读取文件内容，支持 offset / limit 分段读取大文件' },
    { name: 'edit_file', desc: '编辑已有文件，基于 old_string / new_string 精确替换' },
    { name: 'write_file', desc: '创建新文件并写入内容' },
    { name: 'shell_exec', desc: '执行 Shell 命令，高危操作需用户确认' },
    { name: 'search_code', desc: '代码语义搜索，支持正则与模糊匹配' },
    { name: 'list_files', desc: '浏览项目目录结构，支持递归与过滤' },
    { name: 'ask_user', desc: '向用户提问或澄清需求，支持选项式交互' },
    { name: 'agent', desc: '启动单个子 Agent 执行独立任务' },
    { name: 'multiagent', desc: '并行启动多个子 Agent 协作处理' },
    { name: 'orchestrate', desc: 'Planner / Worker 编排模式，任务分解执行' },
  ]

  return (
    <section id="tools" className="py-24 px-6 bg-bg">
      <div className="text-center mb-16 reveal">
        <div className="font-mono text-[0.7rem] tracking-[0.2em] text-green uppercase mb-3">// 内置工具</div>
        <h2 className="font-sans text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">开箱即用的工具集</h2>
        <p className="text-text-dim max-w-[560px] mx-auto mt-4 leading-[1.7] text-[1.05rem]">10 个精心设计的内置工具，覆盖代码操作的全链路</p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-[1100px] mx-auto"
      >
        <table className="tools-table">
          <thead>
            <tr><th>工具</th><th>说明</th></tr>
          </thead>
          <tbody>
            {tools.map((t, i) => (
              <tr key={i}>
                <td className="text-green font-semibold">{t.name}</td>
                <td className="text-text-dim">{t.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </section>
  )
}

/* ============ CAPABILITIES (Tabs) ============ */
function Capabilities() {
  const [activeTab, setActiveTab] = useState(0)
  const capabilities = [
    {
      category: '文件操作',
      items: [
        { name: 'read_file', detail: '分段读取、语法高亮、行号定位' },
        { name: 'edit_file', detail: '精确替换、diff 预览、批量编辑' },
        { name: 'write_file', detail: '自动创建目录、模板生成' },
        { name: 'list_files', detail: '递归浏览、过滤模式、树形展示' },
      ],
    },
    {
      category: '代码智能',
      items: [
        { name: 'search_code', detail: '语义搜索、正则匹配、跨文件引用追踪' },
        { name: '代码分析', detail: '依赖分析、复杂度检测、潜在 Bug 提示' },
        { name: '重构建议', detail: '提取函数、变量重命名、模式识别' },
        { name: '类型推断', detail: 'TS 类型补全、接口生成、类型检查' },
      ],
    },
    {
      category: '命令执行',
      items: [
        { name: 'shell_exec', detail: '安全沙箱、高危命令确认、输出捕获' },
        { name: '测试运行', detail: '自动检测测试框架、失败定位、覆盖率' },
        { name: 'Git 操作', detail: 'diff 查看、commit 建议、分支管理' },
        { name: '包管理', detail: '依赖安装、版本检查、漏洞扫描' },
      ],
    },
    {
      category: 'Agent 协作',
      items: [
        { name: 'agent', detail: '单任务子 Agent，独立上下文隔离' },
        { name: 'multiagent', detail: '并行多 Agent，结果聚合' },
        { name: 'orchestrate', detail: 'Planner 分解 + Worker 执行 + 汇总' },
        { name: '任务调度', detail: '优先级队列、超时控制、错误重试' },
      ],
    },
    {
      category: '扩展机制',
      items: [
        { name: 'Skills', detail: '领域知识包，可自定义加载' },
        { name: 'Hooks', detail: '16 个生命周期事件，插件化扩展' },
        { name: 'MCP Tools', detail: 'Model Context Protocol 工具挂载' },
        { name: '自定义工具', detail: '注册外部脚本作为 Agent 工具' },
      ],
    },
    {
      category: '记忆与上下文',
      items: [
        { name: '长期记忆', detail: '跨会话保留项目上下文与偏好' },
        { name: '仓库概览', detail: '自动注入项目结构、技术栈信息' },
        { name: '编辑器上下文', detail: 'VS Code 扩展同步当前文件与选区' },
        { name: 'Token 预算', detail: '实时展示用量，防止超限' },
      ],
    },
  ]

  return (
    <section id="capabilities" className="py-24 px-6 bg-gradient-to-b from-bg to-bg-deep">
      <div className="text-center mb-16 reveal">
        <div className="font-mono text-[0.7rem] tracking-[0.2em] text-cyan uppercase mb-3">// Capabilities</div>
        <h2 className="font-sans text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">详细能力矩阵</h2>
        <p className="text-text-dim max-w-[560px] mx-auto mt-4 leading-[1.7] text-[1.05rem]">六大维度，24 项细分能力，全面覆盖开发工作流</p>
      </div>

      <div className="max-w-[900px] mx-auto">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 overflow-x-auto pb-2">
          {capabilities.map((cap, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 font-mono text-[0.8rem] whitespace-nowrap rounded-md transition-all duration-300 ${
                activeTab === i
                  ? 'bg-green/10 text-green border border-green/30'
                  : 'text-text-dim hover:text-text border border-transparent hover:border-border'
              }`}
            >
              {cap.category}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {capabilities[activeTab].items.map((item, j) => (
              <div key={j} className="feature-card spotlight-card">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full bg-green" />
                  <span className="text-[0.9rem] text-text font-medium">{item.name}</span>
                </div>
                <p className="text-[0.85rem] text-text-dim leading-[1.6] pl-5">{item.detail}</p>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}

/* ============ ARCHITECTURE (Sticky Stack) ============ */
function Architecture() {
  const layers = [
    {
      title: 'CLI & Config',
      desc: '命令行参数解析、配置组装、Provider 初始化、运行时环境检测',
      tags: ['config.ts', 'provider.ts', 'cli/commands.ts'],
    },
    {
      title: 'Runtime Layer',
      desc: 'Hooks / Memory / Skills / Observability 初始化，MCP 工具挂载，插件加载',
      tags: ['runtime.ts', 'tools.ts', 'mcp/', 'plugins/'],
    },
    {
      title: 'Agent Loop',
      desc: '核心推理循环：接收输入 → 调用 LLM → 解析工具调用 → 执行 → 返回结果 → 循环',
      tags: ['agent/loop.ts', 'agent/conversation.ts', 'multiagent', 'orchestrate'],
    },
    {
      title: 'Tool Registry',
      desc: '10+ 内置工具注册与调度，支持外部工具动态加载，权限校验与沙箱隔离',
      tags: ['tools/registry.ts', 'tools/base.ts', 'security/sandbox.ts'],
    },
    {
      title: 'Terminal UI',
      desc: '交互式 REPL、流式渲染、斜杠命令、Token 展示、调试日志、确认交互',
      tags: ['cli/repl.ts', 'cli/terminal-ui.ts', 'cli/renderer.ts'],
    },
    {
      title: 'LLM Providers',
      desc: 'Anthropic Claude、OpenAI GPT、ARK 等 OpenAI-compatible 接口统一抽象',
      tags: ['llm/anthropic.ts', 'llm/openai.ts', 'llm/provider.ts'],
    },
  ]

  return (
    <section id="architecture" className="py-24 px-6 bg-gradient-to-b from-bg-deep to-bg">
      <div className="text-center mb-16 reveal">
        <div className="font-mono text-[0.7rem] tracking-[0.2em] text-magenta uppercase mb-3">// System Architecture</div>
        <h2 className="font-sans text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">分层架构设计</h2>
        <p className="text-text-dim max-w-[560px] mx-auto mt-4 leading-[1.7] text-[1.05rem]">从 CLI 解析到 Agent 循环，每一层职责清晰，便于扩展与定制</p>
      </div>
      <div className="max-w-[700px] mx-auto relative">
        {/* Vertical line */}
        <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-green via-cyan to-magenta opacity-20 hidden md:block" />

        <div className="flex flex-col gap-6">
          {layers.map((layer, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="sticky-card ml-0 md:ml-16"
              style={{ top: `${80 + i * 20}px` }}
            >
              <div className="flex items-start gap-4">
                <div className="hidden md:flex w-8 h-8 rounded-full bg-green/10 border border-green/30 items-center justify-center font-mono text-[0.7rem] text-green shrink-0 -ml-20 absolute">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div>
                  <h4 className="font-mono text-[0.95rem] font-semibold text-green mb-2">{layer.title}</h4>
                  <p className="text-text-dim text-[0.85rem] leading-[1.6] mb-3">{layer.desc}</p>
                  <div className="flex gap-2 flex-wrap">
                    {layer.tags.map((tag, j) => (
                      <span key={j} className="font-mono text-[0.65rem] px-2 py-0.5 rounded bg-[rgba(0,212,255,0.08)] text-cyan border border-[rgba(0,212,255,0.15)]">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============ QUICK START ============ */
function QuickStart() {
  const steps = [
    {
      num: '01',
      title: '安装 CLI',
      desc: '全局安装或克隆仓库',
      code: `npm install -g rookie-code
# 或
git clone https://github.com/ljwrookie/rookie_code.git
cd rookie_code
pnpm install`,
    },
    {
      num: '02',
      title: '配置 API Key',
      desc: '支持 Anthropic、OpenAI 和 ARK 三种 LLM 提供方',
      code: `export ANTHROPIC_API_KEY="sk-ant-..."
# 或
export OPENAI_API_KEY="sk-..."
# 或
export ARK_API_KEY="..."`,
    },
    {
      num: '03',
      title: '运行',
      desc: '启动交互式 REPL，用自然语言与代码对话',
      code: `rookie-code

# 或使用指定模型
rookie-code --model claude-sonnet-4-6`,
    },
  ]

  const vscodeSteps = [
    {
      num: '01',
      title: '安装扩展',
      desc: '在 VS Code 中搜索安装，或从 Open VSX 下载',
      code: `# 方式一：VS Code marketplace 搜索 "Rookie Code"
# 方式二：Open VSX 安装
# https://open-vsx.org/extension/rookie/rookie-code-vscode`,
    },
    {
      num: '02',
      title: '自动同步（可选）',
      desc: '扩展默认自动将当前文件路径和选区写入 ~/.rookie-code/editor-context.json',
      code: `# 如需自定义上下文路径
export ROOKIE_EDITOR_CONTEXT_PATH="/abs/path/to/editor-context.json"`,
    },
    {
      num: '03',
      title: '开始使用',
      desc: '在 VS Code 中编辑代码时，CLI 会自动感知当前文件，无需手动复制路径',
      code: `# 在 VS Code 中选中代码 → 打开 CLI → 直接说"帮我重构这个函数"
# Agent 会自动读取 editor-context.json 中的文件路径和选区内容`,
    },
  ]

  return (
    <section id="quickstart" className="py-24 px-6 bg-bg-deep">
      <div className="text-center mb-16 reveal">
        <div className="font-mono text-[0.7rem] tracking-[0.2em] text-green uppercase mb-3">// Quick Start</div>
        <h2 className="font-sans text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">三步启动你的 AI 编程助手</h2>
        <p className="text-text-dim max-w-[560px] mx-auto mt-4 leading-[1.7] text-[1.05rem]">只需配置 API Key，即可在终端中开启智能编程</p>
      </div>
      <div className="max-w-[780px] mx-auto flex flex-col gap-6">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className="step-card"
          >
            <div className="font-mono text-[1.8rem] font-extrabold text-green opacity-40 min-w-[40px] leading-none">{step.num}</div>
            <div className="flex-1">
              <h4 className="font-sans text-[1rem] font-semibold mb-1">{step.title}</h4>
              <p className="text-text-dim text-[0.88rem] leading-[1.6] mb-2">{step.desc}</p>
              <div className="code-block">
                <pre className="m-0"><code>{step.code}</code></pre>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* VS Code Extension */}
      <div className="max-w-[780px] mx-auto mt-20">
        <div className="text-center mb-10 reveal">
          <div className="font-mono text-[0.7rem] tracking-[0.2em] text-cyan uppercase mb-3">// VS Code Extension</div>
          <h3 className="font-sans text-[1.5rem] font-bold tracking-[-0.02em]">搭配 VS Code 扩展，体验更佳</h3>
          <p className="text-text-dim max-w-[560px] mx-auto mt-3 leading-[1.7] text-[0.95rem]">扩展会自动将当前聚焦文件和选区写入上下文，CLI 实时感知编辑器状态</p>
        </div>
        <div className="flex flex-col gap-6">
          {vscodeSteps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="step-card"
            >
              <div className="font-mono text-[1.8rem] font-extrabold text-cyan opacity-40 min-w-[40px] leading-none">{step.num}</div>
              <div className="flex-1">
                <h4 className="font-sans text-[1rem] font-semibold mb-1">{step.title}</h4>
                <p className="text-text-dim text-[0.88rem] leading-[1.6] mb-2">{step.desc}</p>
                <div className="code-block">
                  <pre className="m-0"><code>{step.code}</code></pre>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============ FOOTER ============ */
function Footer() {
  return (
    <footer className="py-12 px-6 text-center border-t border-border bg-bg">
      <div className="font-mono text-[1rem] font-bold text-green mb-3">
        Rookie&nbsp;<span className="text-green">Code</span>
      </div>
      <div className="text-text-dim text-[0.8rem] leading-[1.8]">
        MIT License · Made with ♥ by <a href="https://github.com/ljwrookie" target="_blank" rel="noreferrer" className="text-cyan no-underline hover:underline">ljwrookie</a><br />
        基于 LLM 的终端代码智能体 · 支持长期记忆与多 Agent 协作
      </div>
      <div className="flex gap-6 justify-center mt-4">
        <a href="https://github.com/ljwrookie/rookie_code" target="_blank" rel="noreferrer" className="text-text-dim text-[0.8rem] font-mono no-underline hover:text-green transition-colors">GitHub</a>
        <a href="#features" className="text-text-dim text-[0.8rem] font-mono no-underline hover:text-green transition-colors">功能</a>
        <a href="#architecture" className="text-text-dim text-[0.8rem] font-mono no-underline hover:text-green transition-colors">架构</a>
        <a href="#quickstart" className="text-text-dim text-[0.8rem] font-mono no-underline hover:text-green transition-colors">快速开始</a>
      </div>
    </footer>
  )
}

/* ============ HOOKS ============ */
function useScrollReveal() {
  useEffect(() => {
    const revealEls = document.querySelectorAll('.reveal')
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
        }
      })
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' })
    revealEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

function useSpotlightEffect() {
  useEffect(() => {
    const cards = document.querySelectorAll('.spotlight-card')
    const handleMouseMove = (e: Event) => {
      const card = e.currentTarget as HTMLElement
      const rect = card.getBoundingClientRect()
      const mouseEvent = e as MouseEvent
      card.style.setProperty('--mouse-x', `${mouseEvent.clientX - rect.left}px`)
      card.style.setProperty('--mouse-y', `${mouseEvent.clientY - rect.top}px`)
    }
    cards.forEach((card) => card.addEventListener('mousemove', handleMouseMove))
    return () => cards.forEach((card) => card.removeEventListener('mousemove', handleMouseMove))
  }, [])
}

export default App
