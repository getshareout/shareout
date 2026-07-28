/** HTML for EN/ES language toggle (Admin settings + account menu). */
export function homeLangSwitchHtml(): string {
  return `<div class="wsx-home-lang" role="group" aria-label="Language">
  <button class="home-lang-btn" type="button" data-lang="en" aria-selected="true" title="English" data-i18n-title="settings.languageEn">🇺🇸 EN</button>
  <button class="home-lang-btn" type="button" data-lang="es" aria-selected="false" title="Español" data-i18n-title="settings.languageEs">🇦🇷 ES</button>
</div>`;
}
