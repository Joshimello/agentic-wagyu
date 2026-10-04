import { test,expect } from '@playwright/test';
test('upload and inspect staging while memory stays empty',async({page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'Your evidence, ready for review.'})).toBeVisible();
  const label=`Browser notes ${Date.now()}`;
  await page.getByLabel('Source file').setInputFiles({name:'browser-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Launch on Friday. Browser regression evidence.')});
  await page.getByLabel('Label (optional)').fill(label);
  await page.getByRole('button',{name:'Upload to staging'}).click();
  await page.getByRole('link').filter({hasText:label}).click();
  await expect(page.getByText('Launch on Friday. Browser regression evidence.',{exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByText(/Not pushed to memory/)).toBeVisible();
  const source=page.getByRole('link',{name:'Open original source'});const r=await page.request.get((await source.getAttribute('href'))!);
  expect(await r.text()).toContain('Launch on Friday.');
});
