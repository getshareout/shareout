/**
 * ShareOut Design System - User Home Page Styles
 * My Pages dashboard: Drive-like artifact browser.
 * Confident-blue brand. Use with baseStyles from shell.ts.
 *
 * Decomposed into section modules under ./home/ — this file re-exports the barrel.
 */
import { homePageComponents } from './home/index';
import { homeMobileStyles } from './home.mobile.css';

export { homePageComponents };
export const homePageStyles = homePageComponents + homeMobileStyles;
