declare global {
  namespace App {
    interface Locals {
      access: import('./lib/server/access').AccessRole;
    }
  }
}

export {};
