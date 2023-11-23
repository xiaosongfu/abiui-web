import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('home-page')
export class HomePage extends LitElement {
  render() {
    return html` <h1>Welcome to the Home Page</h1> `;
  }
}
