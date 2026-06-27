import { useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import { app } from '@/data/app';

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-background/60 px-3 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-sm text-muted-foreground sm:px-4">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 text-center 2xl:max-w-screen-2xl">
        <p className="font-medium text-foreground">
          {app.name} · {t('footer.tagline')}
        </p>
        <p>{t('footer.dataSource')}</p>
        <p className="max-w-2xl text-xs">{t('footer.disclaimer')}</p>
        <a
          href={app.repoUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 text-xs hover:text-foreground"
        >
          <Github className="size-3.5" />
          {t('footer.sourceCode')}
        </a>
        <p className="text-xs">© {year} {app.name}</p>
      </div>
    </footer>
  );
}
