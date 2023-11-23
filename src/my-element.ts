import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { Router } from '@lit-labs/router';
import "./pages/home.ts";

@customElement('my-element')
export class MyElement extends LitElement {
  router = new Router(this, [
    {
      path: '/',
      render: () => html`<home-page></home-page>`,
    },
    {
      path: '/about',
      render: () => html`<about-page></about-page>`,
    },
    {
      path: '/contact',
      render: () => html`<contact-page></contact-page>`,
    },
  ]);

  render() {
    return html`
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </nav>
      <main>${this.router.outlet()}</main>
    `;
  }
}

@customElement('about-page')
export class AboutPage extends LitElement {
  render() {
    return html`
      <h1>About Us</h1>
      <p>This is the about page.</p>
    `;
  }
}

@customElement('contact-page')
export class ContactPage extends LitElement {
  render() {
    return html`
      <h1>Contact Us</h1>
      <p>This is the contact page.</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'my-element': MyElement;
  }
}
