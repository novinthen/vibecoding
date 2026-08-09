# Product Blueprint

## Product

**Working name:** Vibe Coding News Portal

## Vision

Build the most useful independent intelligence portal for the vibe-coding ecosystem.

The platform should continuously collect fragmented information from primary sources, technology publications, GitHub, and developer communities, then convert it into:

- normalized Articles;
- consolidated Stories;
- ranked trends;
- release intelligence;
- tool and company intelligence;
- grounded AI summaries;
- explanations of why developments matter;
- searchable historical context.

Long-term positioning:

> **Techmeme + Hacker News + GitHub intelligence + an AI analyst, focused on AI-assisted software development.**

## Multi-Publication Vision

The platform is designed to power **multiple independent publications from one shared intelligence engine**.

Examples may include a global English publication, a Bahasa Malaysia publication, a technical English publication, a founder/business-oriented English publication, and future Tamil, Chinese, Indonesian, or other language publications.

All Publications may share Sources, Articles, Stories, Entities, Topics, factual enrichment, clustering, and ranking signals. Each Publication may independently control its domain, brand, locale, editorial positioning, Story selection, headline, summary, slug, featured state, publication timing, and SEO metadata.

**Canonical intelligence is global; publishing is publication-specific.**

## Core Problem

Relevant information is fragmented across:

- official company blogs;
- changelogs;
- GitHub repositories;
- developer publications;
- Hacker News;
- Reddit;
- YouTube;
- product launch sites;
- newsletters;
- documentation.

Traditional aggregators mainly solve collection. This product must additionally solve:

- duplication;
- event consolidation;
- relevance;
- ranking;
- product tracking;
- release monitoring;
- technical context;
- source transparency.

## Primary Users

### Vibe Coder
Wants new tools, launches, tutorials, product changes, and practical explanations.

### Professional Developer
Wants releases, changelogs, repositories, technical developments, MCP, agents, and model capability changes.

### Founder / Builder
Wants product launches, funding, acquisitions, market movement, and competitive intelligence.

### Secondary: Analyst / Journalist / Researcher
Wants timelines, source verification, and structured historical context.

## Product Principles

1. **Stories, not link dumps.**
2. **Primary sources matter.**
3. **AI assists; sources establish facts.**
4. **Developer relevance beats general popularity.**
5. **Sources and timestamps remain visible.**
6. **Automation must permit editorial override.**
7. **Structured intelligence is more important than decorative AI prose.**
8. **Core public content does not require login.**
9. **The portal complements original reporting rather than replacing it.** Preserve attribution, canonical source links, publication timestamps, and prominent outbound access to original sources. Public presentation should default to metadata, appropriate excerpts, structured intelligence, and grounded summaries rather than reproducing full copyrighted articles without permission or licensing.

## In Scope

- AI coding tools;
- coding agents;
- AI-assisted IDEs;
- vibe-coding platforms;
- model changes that materially affect software development;
- MCP and tool protocols;
- developer infrastructure connected to AI-assisted development;
- important open-source repositories;
- major releases and changelogs;
- funding, acquisitions, pricing changes, shutdowns, partnerships;
- relevant research;
- high-quality tutorials;
- significant developer-community discussions.

## Out of Scope

Do not become a generic AI-news portal.

Exclude by default:

- general chatbot news without coding relevance;
- generic robotics;
- unrelated consumer AI;
- unrelated crypto;
- low-quality SEO content;
- clickbait;
- duplicated press-release syndication;
- unsupported rumours.

## Controlled Top-Level Taxonomy

1. News
2. Releases
3. Tools
4. Coding Agents
5. Models
6. MCP
7. Open Source
8. Developer Infrastructure
9. Tutorials
10. Research
11. Business
12. Community

AI may assign existing Topics but must not create new top-level categories automatically.

## Source Tiers

### PRIMARY
Official company blog, documentation, GitHub release, changelog, official announcement.

### TRUSTED
Established technology/developer reporting.

### SPECIALIST
Recognised developer blogs, newsletters, technical experts, niche publications.

### COMMUNITY
Hacker News, Reddit, GitHub discussions, similar community sources.

### DISCOVERY
Useful for finding leads but not strong enough to establish facts independently.

## Publication Principles

1. One backend should power many publications.
2. A Publication is an editorial/brand unit, not merely a language flag.
3. Localisation may include translation and editorial adaptation.
4. Facts and source provenance remain shared even when presentation differs by Publication.
5. Each Publication has its own canonical URLs, sitemap, metadata, analytics, and SEO identity.
6. Different-language Publications may publish translated/adapted versions of the same Story.
7. Multiple English Publications should have distinct editorial positioning rather than duplicate content.
8. Public content must preserve original-source attribution and outbound access.

## Core Public Experience

MVP pages:

- `/`
- `/latest`
- `/trending`
- `/story/[slug]`
- `/topic/[slug]`
- `/tool/[slug]`
- `/search`

The homepage should eventually include:

- Lead Story
- Trending
- Latest
- Tool Watch
- Release Watch
- GitHub / Developer Signals
- Community Buzz
- Newsletter

Not every module must ship immediately.

## Story Standard

A mature Story page should answer:

1. What happened?
2. Why does it matter?
3. What changed?
4. Who/what is involved?
5. What are the underlying sources?
6. What related stories, releases, or repositories matter?

## MVP Success Definition

A user should be able to answer:

> **What happened in vibe coding today?**

faster and more clearly here than by manually visiting multiple sources.

MVP should eventually:

- ingest at least 30 dependable sources;
- normalize Articles;
- deduplicate obvious duplicates;
- classify relevant content;
- identify Entities;
- generate grounded summaries;
- present Latest and Trending;
- provide usable Story pages;
- support Topic and Tool browsing;
- allow editorial correction;
- surface original sources prominently;
- run without daily technical intervention.

## Product North Star

> **What is changing right now in AI-assisted software development, and what should I pay attention to?**

Features that do not improve this answer should be treated skeptically.
