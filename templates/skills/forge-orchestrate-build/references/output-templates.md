# Orchestration Output Templates

Load this file when writing output for a specific execution mode.

---

## Full Build Output

```markdown
## Starting Phase {N}: {Phase Name}

**Agents involved**: {agent-list}

**Deliverables**:
- [ ] {Deliverable 1}
- [ ] {Deliverable 2}

---

### Task {N}.{M}: {Task Name}
**Agent**: @{agent-name}
**Input**: PRD Section {N}
**Output**: {expected output}

Calling @{agent-name}...

**Completed**: {summary}
```

---

## Feature Execution Output

```markdown
## Starting Feature: {Feature Name}
**Feature PRD**: docs/features/{feature}.md
**Original PRD**: docs/PRD.md

---

## Starting Phase F{N}: {Phase Name}

**Agents involved**: {existing-extended}, {new}, {existing-unchanged}

**Deliverables**:
- [ ] {New component}
- [ ] {Extended API}
- [ ] {Tests}

---

### Task F{N}.{M}: {Task Name}
**Agent**: @{agent-name} (NEW for this feature)
**Input**: Feature PRD Section {N}
**Output**: {expected output}

Calling @{agent-name}...

**Completed**: {summary}

---

## Phase F{N} Complete

**Delivered**:
- {deliverable}
- {deliverable}

**Modified existing files**: {file-list}
**New files**: {file-list}

**Continue to Phase F{N+1}?**
```

---

## Feature-Based Build Output

```markdown
## Building Project from Decomposed Features
**Product Vision**: docs/product-vision.md
**Features**: {N} features identified

### Feature Dependency Order

| Order | Feature | File | Dependencies | Status |
|-------|---------|------|-------------|--------|
| 1 | {Name} | docs/features/{name}.md | None | Pending |
| 2 | {Name} | docs/features/{name}.md | {dep} | Pending |

---

## Starting Feature {N}: {Name}
**Feature document**: docs/features/{name}.md
**Dependencies**: {list}

---

## Feature {N} Complete: {Name}

**Delivered**:
- {deliverable}

**Unlocked features**: {next-features}

**Continue to Feature {N+1}: {Name}?**
```
