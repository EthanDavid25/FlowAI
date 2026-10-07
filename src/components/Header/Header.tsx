import styles from './Header.module.css'

/** FlowAI logo mark — abstract "flow" glyph */
function LogoMark() {
  return (
    <svg
      className={styles.logoMark}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {/* Outer ring */}
      <circle cx="16" cy="16" r="14" stroke="url(#logo-grad)" strokeWidth="2" opacity="0.4" />
      {/* Flow path */}
      <path
        d="M10 20 C10 14 14 12 16 12 C18 12 20 13 20 16 C20 19 18 20 16 20 C14 20 12 19 12 16"
        stroke="url(#logo-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Center dot */}
      <circle cx="16" cy="16" r="2.5" fill="url(#logo-grad)" />
    </svg>
  )
}

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <LogoMark />
        <div className={styles.brandText}>
          <h1 className={styles.title}>
            Flow<span className={styles.titleAccent}>AI</span>
          </h1>
          <p className={styles.tagline}>Your AI co-pilot for any software.</p>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          Foundation 1
        </span>
        <span className={styles.version}>v0.1.0</span>
      </div>
    </header>
  )
}
