/**
 * LibreOffice in a Cloudflare Container (image: containers/slides/): POST /convert with a
 * .pptx/.ppt/.odp body and an `x-ext` header answers the PDF. Only import-slides.ts reaches
 * it, through the optional SLIDES_CONVERTER binding; no public route forwards to it, and
 * the container has no outbound internet (a deck can't fetch remote images or call home).
 */
import { Container } from '@cloudflare/containers';
import type { Env } from '../../types';

export class SlidesConverter extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '2m';
  enableInternet = false;
}
