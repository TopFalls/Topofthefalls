# Project Boundaries

This repository is **Carl Higgins' own instance of Top of the Falls (TOF)**.

It is the same league as the original TOF app — same rules, same venues, same
117-player roster — running on **separate infrastructure that Carl owns**. The
shared identity is exactly why the boundary matters: the two deployments look
alike, so it is easy to point one at the other's database by accident.

## This instance (Carl's)

- Customer/league: Top of the Falls, Great Falls, MT
- League operator / super_admin: Carl Higgins (`cj_higgins@msn.com`)
- GitHub repo: `TopFalls/Topofthefalls`
- Local checkout: `C:/Users/cdali/Downloads/Topofthefalls`
- Package name: `tof-app`
- Production branch: `main`
- Vercel project: **NOT YET PROVISIONED**
- Supabase project/ref: **NOT YET PROVISIONED**
- Public URL: pending first deploy (Vercel default `*.vercel.app`)

## Original TOF app (Chase's) — separate, do not touch

The upstream app this repo was cloned from. It is live and Carl's players may
already be using it.

- GitHub repo: `cdalin1985/TOF`
- Vercel project: `tof-app`
- Public URL: `https://tof-app-theta.vercel.app`
- Supabase project/ref: `sqcqmovskpoyutfyslym`
- Local checkout: `C:/Users/chase/tof-app`

## TOC.Monster / Top of the Capital — separate, do not touch

- League/app: Top of the Capital / Helena Pool League
- GitHub repo: `cdalin1985/claude-agent0toc`
- Vercel project: `toc-app`
- Public URL: `https://toc.monster`
- Supabase project: `toc1`
- Local checkout: `C:/Users/chase/toc-monster-app`

## Rules

1. This instance must never read from or write to the original TOF app's
   Supabase project (`sqcqmovskpoyutfyslym`) or TOC.Monster's (`toc1`).
2. This instance must never deploy to Vercel project `tof-app` or `toc-app`.
3. `sqcqmovskpoyutfyslym` is a **forbidden literal** in this repo's source. It
   was previously hardcoded as a fallback in `src/lib/supabase.ts` and as a cron
   target in `.github/workflows/keepalive.yml`; both are fixed and must stay
   fixed.
4. Sharing a roster is fine — it is Carl's roster. Sharing a **database** is not:
   a match result recorded here must not appear in the upstream app, or vice
   versa.
5. Do not copy data out of the upstream app's database into this one. The roster
   is seeded from migrations in this repo, not exported from a live project.

If a folder name and project identity disagree, stop and verify with:

```bash
git remote -v
cat .vercel/project.json
cat supabase/.temp/project-ref 2>/dev/null || true
```
