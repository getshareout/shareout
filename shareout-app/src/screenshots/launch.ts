// Puppeteer is ~350 modules. It loads when a browser actually opens, not wherever a module
// that can take a screenshot is imported (email, Slack delivery, the data middleware all can):
// a static import put it in the import graph of ~350 test files.
import type puppeteer from '@cloudflare/puppeteer';

export type LaunchedBrowser = Awaited<ReturnType<typeof puppeteer.launch>>;

export async function launchBrowser(binding: unknown): Promise<LaunchedBrowser> {
  const { default: browser } = await import('@cloudflare/puppeteer');
  return browser.launch(binding as Parameters<typeof puppeteer.launch>[0]);
}
