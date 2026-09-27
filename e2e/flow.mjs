import { chromium } from 'playwright';
const base = process.env.BASE ?? 'http://localhost:4100';
const shots = process.env.SHOTS ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const errors = [];
async function ctx() {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return p;
}
async function login(p, email, pw) {
  await p.goto(base + '/entrar');
  await p.getByLabel('Email').fill(email);
  await p.getByLabel('Palavra-passe').fill(pw);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL(base + '/');
  await p.getByRole('button', { name: 'Sair' }).waitFor({ timeout: 5000 });
}
// Eleitor vota
const v = await ctx();
await login(v, 'eleitor1@evoto.local', 'Eleitor12345');
await v.screenshot({ path: `${shots}/1-eleicoes.png` });
await v.getByText('Eleição da Direcção').click();
await v.getByText('Lista B — Unidos').click();
await v.screenshot({ path: `${shots}/2-boletim.png` });
await v.getByRole('button', { name: 'Continuar' }).click();
await v.getByRole('button', { name: 'Confirmar voto' }).click();
await v.getByText('Voto registado com sucesso').waitFor();
await v.screenshot({ path: `${shots}/3-recibo.png` });
const receipt = (await v.locator('p.font-mono').textContent()).trim();
console.log('recibo', receipt);
await v.goto(base + '/verificar');
await v.getByLabel('Eleição').selectOption({ index: 1 });
await v.getByLabel('Código do recibo').fill(receipt);
await v.getByRole('button', { name: 'Verificar' }).click();
await v.getByText('Boletim encontrado').waitFor();
await v.screenshot({ path: `${shots}/4-verificar.png` });
// Admin
const a = await ctx();
await login(a, 'admin@evoto.local', 'Admin12345!');
await a.goto(base + '/admin');
await a.getByText('Cadeia de auditoria').waitFor();
await a.screenshot({ path: `${shots}/5-admin.png` });
await a.goto(base + '/admin/eleicoes');
await a.getByText('Eleição da Direcção').click();
a.on('dialog', (d) => d.accept());
await a.getByRole('button', { name: 'Encerrar e apurar' }).click();
await a.getByText('Integridade do apuramento').waitFor();
await a.screenshot({ path: `${shots}/6-resultados.png`, fullPage: true });
await a.goto(base + '/admin/auditoria');
await a.getByText('ballot.cast').waitFor();
await a.screenshot({ path: `${shots}/7-auditoria.png` });
// Mobile + registo
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await m.goto(base + '/registar');
await m.screenshot({ path: `${shots}/8-registo-mobile.png`, fullPage: true });
console.log('erros de consola:', errors);
await browser.close();
