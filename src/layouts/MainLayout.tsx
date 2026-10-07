import type { ReactNode } from 'react'
import styles from './MainLayout.module.css'

interface MainLayoutProps {
  children: ReactNode
}

/**
 * MainLayout wraps the entire app window.
 * The titlebar area is handled by Electron's titleBarOverlay,
 * so we just leave a top-padding equal to --titlebar-height.
 */
export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
