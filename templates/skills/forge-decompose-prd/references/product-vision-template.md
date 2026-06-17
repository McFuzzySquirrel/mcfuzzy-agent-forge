# Product Vision Template

Load this when writing a product vision document.

```markdown
# Product Vision: [Product Name]

## 1. Overview

**Product Name:** ...
**Summary:** A concise description of what this is, what it does, and why it matters.
**Target Platform:** Where this runs or is deployed.
**Key Constraints:** Any overarching constraints.
**Original PRD:** [Link to original PRD, e.g., docs/PRD.md]

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | — | Initial product vision (decomposed from PRD) |

---

## 3. Goals and Non-Goals

### 3.1 Goals
- [Extracted from original PRD Section 3.1]

### 3.2 Non-Goals
- [Extracted from original PRD Section 3.2]

---

## 4. Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| [Extracted from original PRD Section 4.1] |

---

## 5. Research Findings

[Extracted from original PRD Section 5]

---

## 6. Technical Architecture

### 6.1 Technology Stack
[Extracted from original PRD Section 7.1]

### 6.2 Project Structure
[Extracted from original PRD Section 7.2]

### 6.3 Key APIs / Interfaces
[Extracted from original PRD Section 7.3]

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| [Extracted from original PRD Section 9] |

---

## 8. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| [Extracted from original PRD Section 10] |

---

## 9. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| [Extracted from original PRD Section 11] |

---

## 10. System States / Lifecycle

[Extracted from original PRD Section 13]

---

## 11. Analytics / Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| [Extracted from original PRD Section 16] |

---

## 12. Dependencies and Risks

### 12.1 Dependencies
[Extracted from original PRD Section 18.1]

### 12.2 Risks
[Extracted from original PRD Section 18.2]

---

## 13. Future Considerations

[Extracted from original PRD Section 19]

---

## 14. Features

Summary of all features decomposed from this product vision:

| # | Feature | File | Dependencies | Priority |
|---|---------|------|-------------|----------|
| 1 | [Name] | [docs/features/name.md](features/name.md) | None | Must |
| 2 | [Name] | [docs/features/name.md](features/name.md) | Feature 1 | Must |

### Feature Dependency Graph

```
Feature 1 (foundation)
├── Feature 2 (can start after Feature 1)
├── Feature 3 (can start after Feature 1)
└── Feature 4 (requires Feature 2 + Feature 3)
```

---

## 15. Glossary

| Term | Definition |
|------|------------|
| [Extracted from original PRD Section 21] |

---

## 16. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| [Extracted from original PRD Section 20] |
```
