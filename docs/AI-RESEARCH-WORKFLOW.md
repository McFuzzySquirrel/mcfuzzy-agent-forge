---
layout: post
title:  "The AI-Assisted Research Habit: From Questions to Informed Decisions"
date:   2026-03-26 05:55:00 +0200
categories: personal workflow
---

# The AI-Assisted Research Habit: From Questions to Informed Decisions

> *How pairing AI for research with AI for implementation creates a workflow where every decision is informed, documented, and traceable.*


## The Evolution of a Habit

Every developer has their own way of researching before making changes. Some dive into documentation. Some experiment in branches. Some just start coding and see what breaks. But there's always this nagging feeling: *Am I missing something? Is there a better way I don't know about?*

That uncertainty led me to develop a habit that's transformed how I approach any significant technical decision: **AI-assisted research paired with AI-assisted implementation, all tied together through Architecture Decision Records (ADRs).**

This isn't about a specific tool or project. It's about a *process* that works regardless of what you're building or what AI tools you're using. The pattern is what matters.

---

## The Two-Phase Dance: Research, Then Build

Here's the workflow that emerged from months of iteration:

### Phase 1: Research with AI Assistance

When a question arises — "Should we use this library?" "How do we handle this edge case?" "What's the best approach for this problem?" — instead of jumping to Stack Overflow or diving into code, I start a research conversation with an AI assistant.

But this isn't just asking "what should I do?" It's a structured exploration:

**1. Frame the Question Clearly**
   - What exactly am I trying to solve?
   - What constraints do I have? (technical, time, team skills)
   - What's the current state of things?

**2. Let AI Help Explore the Landscape**
   - What approaches exist?
   - What are the trade-offs of each?
   - What are the risks I might not have considered?
   - What's the current best practice (not what was best practice three years ago)?

**3. Challenge and Refine**
   - "What if we have to scale this?"
   - "What breaks if X changes?"
   - "What are we assuming that might not be true?"

The AI doesn't just answer questions — it helps you *ask better questions*. It surfaces considerations you didn't know to look for.

**The Output**: Not a decision, but a **research document**. A structured analysis that includes:
- The question and context
- Current state analysis
- Options explored with pros/cons
- Risk assessment
- Recommended approach with rationale
- Implementation considerations

This document becomes a snapshot of understanding. Future-you (or your teammates) can see not just *what* was decided, but *why*, based on what information.

### Phase 2: Implementation with AI Coding Sessions

Now comes the powerful part. With the research document as a foundation, I engage a coding AI assistant — but not blindly.

**The Coding Session Workflow:**

**1. Start with Context**
   - Share the research document
   - Point to relevant parts of the codebase
   - Clarify the specific task

**2. Let AI Do Its Research**
   - The AI assistant explores the codebase
   - It identifies what files need changes
   - It spots dependencies and impacts
   - It considers edge cases based on the research

**3. Review the Plan**
   - AI proposes changes across multiple files
   - Shows how pieces fit together
   - Highlights potential issues
   - Explains the reasoning

**4. Iterate and Refine**
   - Review each proposed change
   - Question assumptions
   - Adjust approaches
   - Add missing considerations

**5. Implement with Understanding**
   - Changes are made with full context
   - No mysterious "why did we do it this way?" moments
   - Every decision traceable back to research

**The Magic**: The AI coding assistant has access to:
- Your research findings
- Its own exploration of the codebase
- Understanding of how changes interconnect
- Awareness of testing implications

It's not just writing code — it's presenting a *holistic solution* that you can understand, review, and approve with confidence.

### Phase 3: Codify in Architecture Decision Records

Here's where everything comes together. Once research is done and implementation is approved, the decision gets immortalized in an ADR.

**The ADR captures:**
- What was decided
- Why (linking back to the research)
- Alternatives considered
- Consequences expected
- Status (proposed, accepted, superseded)

**The Powerful Part**: The ADR includes links to:
- The original research document
- Related code changes (PRs, commits)
- Other ADRs it affects or is affected by
- External references that informed the decision

This creates a **knowledge graph** of your project's evolution. Not scattered across Slack threads, not lost in closed PRs, not hidden in code comments — but structured, searchable, and connected.

---

## Why This Changes Everything

### 1. **Decisions Are Informed, Not Impulsive**

You're not coding based on "I think this is right." You're implementing based on researched, analyzed, documented understanding.

### 2. **Context Persists Beyond Memory**

Six months later, when someone asks "why did we choose this approach?", you don't rely on memory. You point to the ADR, which points to the research, which shows the full reasoning.

### 3. **Onboarding Becomes Learning**

New team members don't just see code — they see the *thinking* behind it. ADRs become a roadmap of how the project evolved and why.

### 4. **Course Corrections Are Data-Driven**

When an ADR decision needs revisiting, you start with the original research. What's changed? What new information do we have? The ADR gets superseded with a new one, preserving history.

### 5. **AI Assists, Humans Decide**

The AI tools help you explore, understand, and implement — but you're always in control. You review, you edit, you approve. The AI amplifies your capability; it doesn't replace your judgment.

---

## The Pattern, Agnostic to Tools

This workflow works regardless of your stack:

- **Research AI**: Could be ChatGPT, Claude, GitHub Copilot Chat, or any conversational AI that helps you explore and analyze.

- **Coding AI**: Could be GitHub Copilot, Cursor, Cody, or any AI coding assistant that understands codebases and can propose changes.

- **ADRs**: Just markdown files in a `/docs/adr/` directory (or wherever your team keeps them). Tools exist, but plain markdown works perfectly.

**The Universal Steps:**

```
Question arises
    ↓
Research with AI (document findings)
    ↓
Code with AI (implement with full context)
    ↓
Review & approve changes
    ↓
Create/update ADR (link everything together)
    ↓
Knowledge graph grows
```

---

## Real-World Example: Adding a New Feature

Let's make this concrete with a generic example:

**Scenario**: Your project needs caching to improve performance.

### Step 1: Research Session

*Conversation with AI:*
- "We need to add caching. What are the common approaches?"
- "We're using [your stack]. What works best here?"
- "What about cache invalidation strategies?"
- "What are the performance implications?"
- "What breaks if cache goes down?"

*Output*: `docs/research/caching-strategy.md`
- Explores Redis, Memcached, in-memory options
- Analyzes trade-offs for your specific use case
- Recommends Redis with specific rationale
- Details implementation considerations
- Identifies risks and mitigation strategies

### Step 2: Coding Session

*Engagement with coding AI:*
- Share the research document
- "Implement Redis caching based on this research"

*AI Explores*:
- Reviews codebase structure
- Identifies where caching should be added
- Finds dependency injection points
- Considers error handling
- Plans configuration management

*AI Proposes*:
- Cache service implementation
- Integration with existing services
- Configuration files
- Error handling middleware
- Tests for cache hit/miss scenarios

*You Review*:
- Check each proposed change
- Adjust cache TTL values
- Add project-specific error handling
- Approve implementation

### Step 3: ADR Creation

Create `docs/adr/NNN-redis-caching.md`:

```markdown
# ADR-NNN: Implement Redis for Application Caching

**Date**: 2026-03-26
**Status**: Accepted

## Context

Performance testing revealed response times >500ms for data-heavy endpoints.
Research (see [caching-strategy.md](../research/caching-strategy.md)) 
explored multiple caching solutions.

## Decision

Implement Redis as application-level cache with:
- Cache-aside pattern
- 1-hour default TTL
- Separate cache keys per tenant
- Graceful degradation on cache failure

## Alternatives Considered

- Memcached: Lighter weight, but lacks persistence we may need later
- In-memory: Simple, but doesn't scale across instances
- CDN caching: Addresses different layer; complementary, not alternative

## Consequences

**Positive**:
- Expected 80% reduction in database load for cached queries
- Improved response times for frequently accessed data
- Foundation for future optimizations (session storage, job queues)

**Negative**:
- Additional infrastructure dependency
- Complexity in cache invalidation
- Memory usage requires monitoring

**Neutral**:
- Team needs Redis knowledge (addressed via documentation)

## References

- [Research Document](../research/caching-strategy.md)
- [Implementation PR](#123)
- [Redis Official Docs](https://redis.io/docs/)
```

Now everything is connected. The ADR links to the research. Future PRs reference the ADR. Knowledge accumulates instead of scattering.

---

## The Habit's Impact

After adopting this workflow, several things changed:

### Confidence in Decisions

Every significant change starts from a position of knowledge, not guesswork. The research phase ensures you've considered what you need to consider.

### Implementation Speed

Paradoxically, adding a research step *speeds up* implementation. Why? Because you're not coding, then discovering issues, then refactoring, then discovering more issues. You understand the landscape before you start building.

### Code Review Quality

When you open a PR with "Implements caching per ADR-025," reviewers can:
1. Read the ADR to understand the decision
2. Check the research to see alternatives considered
3. Review the code with full context

Reviews become about execution, not re-litigating the approach.

### Team Alignment

Everyone on the team can see the project's decision history. Discussions reference ADRs. New patterns emerge from synthesizing multiple ADRs. The team builds shared understanding.

### Future-Proofing

When you inevitably need to change something, you start with:
- The original ADR explaining why it was built that way
- The research that informed the decision
- Understanding of what constraints have changed

You're not reverse-engineering old code — you're revisiting documented decisions with new information.

---

## Starting Your Own Habit

You don't need special tools to adopt this workflow. Here's how to start:

### 1. Create Structure

```
docs/
  research/        # Research documents
  adr/             # Architecture Decision Records
```

### 2. Pick a Research Template

Keep it simple:
- **Question**: What are we trying to figure out?
- **Context**: Current state, constraints
- **Analysis**: Options, trade-offs, risks
- **Recommendation**: What to do and why
- **Implementation Notes**: How to approach it

### 3. Pick an ADR Template

Michael Nygard's format works great:
- Title (numbered: ADR-001, ADR-002, etc.)
- Status (Proposed, Accepted, Superseded)
- Context
- Decision
- Consequences

### 4. Establish the Flow

For any significant decision:
1. Research → document
2. Code (referencing research) → review
3. ADR (linking research + code) → commit

### 5. Link Everything

Research docs reference relevant ADRs.
ADRs reference research docs and PRs.
Code comments reference ADRs for "why."
PRs reference ADRs in descriptions.

---

## The Meta-Lesson

This habit isn't really about AI, research, or ADRs. It's about something more fundamental:

**Making the implicit explicit.**

Developers carry so much in their heads: why we chose this library, what we considered and rejected, what could break if we change X. This workflow externalizes that knowledge, making it visible, reviewable, and persistent.

AI tools supercharge this by:
- Helping surface what you might not think to research
- Exploring codebases faster than manual review
- Proposing holistic solutions across multiple files
- Maintaining consistency across changes

But the core principle works even without AI: research before you build, document decisions, connect the dots.

---

## Your Turn

This workflow evolved from frustration with "I think this is right" coding and the sinking feeling of revisiting old code with no idea why it's that way.

You don't need to adopt everything at once. Start small:
- Next time you face a decision, write a quick research doc
- Next time you make a significant change, write an ADR
- Link them together

Over time, you'll build something more valuable than code: a **knowledge graph of your project's evolution**, where every decision is traceable, every choice is documented, and context never gets lost.

The tools will evolve. The pattern won't.

---

**Start simple. Research deliberately. Document decisions. Connect the dots. Watch your confidence in your codebase grow.**
