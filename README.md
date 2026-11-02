# Melo

**Closer, even from afar.**

Melo is a private, mobile-first messaging app concept for a circle of exactly four people.

## Current status

The first commit contains the light-theme interface prototype:
- Responsive conversation list and chat view
- Teal and soft-white visual system
- Mobile chat navigation
- Local-only demo message composer

**Important:** This is currently a frontend prototype. Messages are not yet sent to other devices, accounts are not authenticated, and membership is not enforced. Do not use it for private conversations until Firebase Authentication, Firestore security rules, and the four-member allowlist are implemented and tested.

## Planned stack

- Static frontend: HTML, CSS and JavaScript
- Authentication: Firebase Authentication
- Real-time messages: Cloud Firestore
- Optional media: Firebase Storage
- Hosting: GitHub Pages

## Run locally

Open `index.html` in a browser. No build step is required.

## Deployment

In the repository settings, enable GitHub Pages using the `main` branch and `/(root)` folder.
