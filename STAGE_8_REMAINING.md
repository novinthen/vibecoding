# Stage 8 Remaining Work Checklist

## Status: IN PROGRESS

### ✅ Completed

1. Core ranking service (deterministic formulas)
2. Ranking engine (orchestration)
3. Repository layer
4. Admin service (backend)
5. Public ranking queries
6. Unit tests (40 tests passing)
7. Integration tests (9 tests covering all requirements)
8. Fixed ranking precedence (publication-specific wins)
9. Fixed double-counting (editorial adjustment in formula only)
10. Restored package-lock.json from main

### 🚧 Remaining

#### 1. Admin UI (HIGH PRIORITY)

- [ ] Story detail ranking card component
- [ ] Display: score, signals, version, timestamp, history
- [ ] Manual trigger button (authorized)
- [ ] Edit PublicationStory controls (featured, priority, suppress)

#### 2. Public Route Integration (HIGH PRIORITY)

- [ ] Wire ranking into homepage (top stories section)
- [ ] Wire ranking into topic pages
- [ ] Add /top route (not "trending")
- [ ] Keep /latest chronological

#### 3. Documentation Updates (CRITICAL)

- [ ] README.md
- [ ] docs/DATA_MODEL.md
- [ ] docs/ADMIN.md
- [ ] docs/PUBLIC_PORTAL.md
- [ ] docs/ARCHITECTURE.MD
- [ ] docs/ROADMAP.md (if needed)
- [ ] docs/CURRENT_STAGE.md (final)

#### 4. Validation

- [ ] Run full test suite
- [ ] Run typecheck
- [ ] Run build
- [ ] Verify git diff shows actual implementation
- [ ] Two-publication smoke test (if DB available)

## Time Estimate

- Admin UI: ~30 min
- Public routes: ~20 min
- Documentation: ~40 min
- Validation: ~20 min
  Total: ~2 hours

## Next Steps

1. Create admin UI ranking card
2. Integrate public routes
3. Update all documentation
4. Run full validation
5. Commit and push
6. STOP (no PR, no Stage 9)
