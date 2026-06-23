import { T, EditModeToggle } from '@glot-manager/react';

export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 40,
        }}
      >
        <strong style={{ fontSize: 18 }}>Glot Manager</strong>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <a href="#" style={{ color: '#475569', textDecoration: 'none' }}>
            <T id="nav.pricing">Pricing</T>
          </a>
          {/* The toggle renders only for admins. */}
          <EditModeToggle />
        </nav>
      </div>

      <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: '0 0 16px' }}>
        <T id="home.title">Translate your app in context</T>
      </h1>

      <p style={{ fontSize: 18, color: '#475569', margin: '0 0 32px' }}>
        <T id="home.subtitle">
          Flip on edit mode, click any highlighted label, and edit every language right here.
        </T>
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          style={{
            background: '#4f46e5',
            color: '#fff',
            border: 0,
            borderRadius: 8,
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <T id="cta.primary">Get started</T>
        </button>
        <button
          style={{
            background: '#fff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <T id="cta.secondary">Read the docs</T>
        </button>
      </div>

      <footer style={{ marginTop: 80, color: '#94a3b8', fontSize: 14 }}>
        <T id="footer.tagline">Built with Glot Manager — in-context, AI-native translation.</T>
      </footer>
    </main>
  );
}
