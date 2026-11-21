import { startApp } from './app/app';

startApp().catch((err: unknown) => {
  console.error(err);
  const el = document.createElement('div');
  el.className = 'wl-fatal';
  el.innerHTML = '<h2>Mr Sparkles couldn’t start</h2><p></p><button type="button">Try again</button>';
  el.querySelector('p')!.textContent = String((err as Error)?.message ?? err);
  el.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(el);
});
