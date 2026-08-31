# Form Autocomplete

Instrument local care încarcă o pagină (ex. un formular de login JSF/PrimeFaces) într-un iframe prin intermediul unui proxy same-origin și completează automat câmpurile configurate. Fiecare câmp este introdus separat (etichetă + selector CSS + valoare), iar rezultatul completării este afișat în interfață.

## Cum funcționează

1. Introdu URL-ul paginii țintă (ex. `http://localhost:8080/RaportIndividualZilnicWebAppV4/login.xhtml`).
2. Configurează câmpurile: etichetă, selector CSS (ex. `#loginForm\:username`) și valoare.
3. Apasă „Încarcă pagina și completează”. Pagina este încărcată prin `/api/proxy?url=...` (same-origin), deci câmpurile pot fi completate din JavaScript chiar dacă pagina țintă este pe alt server.
4. Panoul „Câmpuri completate” arată ce s-a completat, ce nu s-a găsit și eventualele erori.

## Testare locală

O pagină demo care imită formularul de login (aceleași id-uri) este servită la:

```
http://localhost:3000/sample-login.html
```

Folosește acest URL ca pagină țintă pentru a testa fluxul fără un server extern.

## Pornire

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
