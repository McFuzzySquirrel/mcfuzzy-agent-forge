# Forge Research  
  
Yes — **but not simply because they are sequential**. The token savings come from **how much context each agent receives and what work each agent repeats**.  
Think of it like this:  
**Parallel agents**  
Suppose you have 3 agents:  
```
                 ┌─ Agent A: Research
User request ────┼─ Agent B: Analyse
                 └─ Agent C: Review

```
If each agent gets the full original prompt + large shared context, you might effectively send:  
```
Large context → A
Large context → B
Large context → C

```
So input tokens can multiply quickly.  
**Sequential/task-specific agents**  
You can instead do:  
```
User request
     ↓
Agent A
Research
     ↓
small structured result
     ↓
Agent B
Analyse only the result
     ↓
small structured result
     ↓
Agent C
Review only what it needs

```
This **can be considerably cheaper**, because each agent has a deliberately scoped context.  
But there’s an important catch:  
**Sequential execution doesn’t inherently use fewer tokens. Context design does.**  
   
⸻  
   
## A useful way to think about your agent workforce idea  
Given the work you’ve been doing around agent skills, workflows and agent identities, I’d actually model agents around **task boundaries**, rather than simply having a bunch of autonomous agents.  
For example:  
```
                    ┌──────────────┐
                    │   Request    │
                    └──────┬───────┘
                           ↓
                  ┌─────────────────┐
                  │ Planning Agent  │
                  └────────┬────────┘
                           ↓
                ┌─────────────────────┐
                │ Task-specific work  │
                └───────┬───────┬─────┘
                        ↓       ↓
                   Research   Calculation
                        ↓       ↓
                        └───┬───┘
                            ↓
                    ┌──────────────┐
                    │ Synthesis    │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │ Review Agent │
                    └──────────────┘

```
Each agent gets:  
* its **skill/instructions**  
* only the **input relevant to its task**  
* only the **outputs from previous tasks it needs**  
* access to tools appropriate to that task  
* a small, structured output contract  
That is much more token-efficient than giving every agent the entire conversation.  
   
⸻  
   
**There’s another interesting effect**  
Imagine:  
**Parallel**  
```
Agent A: 10k input + 2k output
Agent B: 10k input + 3k output
Agent C: 10k input + 2k output

Total ≈ 35k tokens

```
But with a pipeline:  
```
Planner:   5k input + 1k output
Research:  2k input + 2k output
Analysis:  3k input + 2k output
Review:    2k input + 1k output

Total ≈ 18k tokens

```
The pipeline isn’t cheaper because it is sequential. It’s cheaper because **the information boundary between agents is smaller**.  
   
⸻  
   
## And there’s a really powerful pattern here  
You don’t necessarily want:  
**Agent → Agent → Agent**  
You want:  
**Task → Agent → Artifact → Task → Agent → Artifact**  
For example:  
```
Task: Find relevant information
        ↓
Research Agent
        ↓
ResearchArtifact
        ↓
Task: Compare options
        ↓
Analysis Agent
        ↓
ComparisonArtifact
        ↓
Task: Validate recommendation
        ↓
Review Agent
        ↓
DecisionArtifact

```
The artifact might be JSON, a short markdown document, database record, etc.  
That gives you a **token firewall** between agents.  
The next agent doesn’t need to know *how* the previous agent arrived at its conclusion. It only needs the relevant artifact.  
   
⸻  
   
**Where parallel actually wins**  
Parallel is still better when tasks are genuinely independent:  
```
              ┌─ Research Azure
              │
Request ──────┼─ Research AWS
              │
              └─ Research GCP
                       ↓
                    Synthesis

```
There’s no reason for Azure research to wait for AWS research.  
So the ideal architecture is probably **hybrid**:  
```
                 Planner
                    │
          ┌─────────┼─────────┐
          ↓         ↓         ↓
       Agent A   Agent B   Agent C
          │         │         │
          └─────────┼─────────┘
                    ↓
                 Synthesizer
                    ↓
                  Reviewer

```
You get **parallelism where the work is independent**, while keeping **sequential boundaries where context can be progressively reduced**.  
And this fits *very nicely* with the agent-workforce / Durable Workflow / skills approach you’ve been exploring: **the workflow becomes the thing that decides which agent gets which context, rather than agents blindly passing the entire conversation around.**  
  
So what would be the most efficient way to create and then consume the artifact - a small db locally, or jsonl or does it not matter?  
  
Yes — and I’d actually separate **the artifact format** from **the storage mechanism**.  
For the agent-workforce pattern you’re exploring, I wouldn’t use a database by default. I’d start with **small, structured JSON artifacts**, stored as files, and only introduce a DB when you need querying, concurrency, history, or scale.  
**My preferred architecture**  
```
Workflow
   │
   ├── Agent A
   │      ↓
   │   artifact.json
   │
   ├── Agent B reads artifact.json
   │      ↓
   │   artifact.json
   │
   └── Agent C reads only required fields

```
The key isn’t whether it’s JSON vs JSONL vs SQLite.  
It’s **how small and deterministic the artifact is**.  
For example, don’t pass this:  
```
{
  "conversation": "...huge conversation...",
  "research_notes": "...5,000 words...",
  "agent_reasoning": "...",
  "sources": [...]
}

```
Instead produce something like:  
```
{
  "task": "compare-cloud-providers",
  "status": "complete",
  "findings": [
    {
      "provider": "Azure",
      "score": 8,
      "reason": "Strong integration with existing stack"
    },
    {
      "provider": "AWS",
      "score": 7,
      "reason": "Broad service ecosystem"
    }
  ],
  "confidence": 0.87,
  "next_action": "review_recommendation"
}

```
Now the next agent might only consume:  
```
task
findings
confidence
next_action

```
That’s where your token savings come from.  
   
⸻  
   
## JSON vs JSONL vs SQLite  
I’d think about it like this:  

| Approach | Best for | My take |
| -------- | ---------------------------------- | ----------------------------------------- |
| JSON | One artifact representing one task | ⭐ Best starting point |
| JSONL | Stream/log many artifacts | ⭐ Excellent for agent runs |
| SQLite | Querying lots of artifacts/state | ⭐ Add when needed |
| Full DB | Distributed/concurrent workforce | Later |
| Redis | Ephemeral workflow state | Useful but probably unnecessary initially |
  
**JSON**  
Best when you have:  
```
Task → Artifact → Task

```
Each artifact is a discrete object.  
For example:  
```
/workflow/
    task-001/
        research.json
        analysis.json
        review.json

```
Very easy to inspect, replay, version and debug.  
   
⸻  
   
**JSONL gets interesting for your agent-session work**  
Given your previous **EJS / SAURON-style agent observability** ideas, JSONL could be particularly useful.  
You could have:  
```
workflow.jsonl

```
with:  
```
{"event":"task.started","agent":"researcher","task":"find_options"}
{"event":"artifact.created","artifact":"research-001","tokens":1842}
{"event":"task.started","agent":"analyst","task":"compare_options"}
{"event":"artifact.created","artifact":"analysis-001","tokens":923}
{"event":"task.completed","agent":"reviewer"}

```
That’s effectively an **append-only event log**.  
Very cheap and extremely useful for replay/debugging.  
   
⸻  
   
## Then SQLite becomes your index  
This is where I’d probably take your architecture eventually:  
```
                 ┌─────────────────┐
                 │ Workflow Engine │
                 └────────┬────────┘
                          │
              ┌───────────┴───────────┐
              ↓                       ↓
        Artifact Store           Event Log
           JSON files              JSONL
              │                       │
              └───────────┬───────────┘
                          ↓
                       SQLite
                    (metadata/index)

```
SQLite doesn’t necessarily store the whole artifact.  
It can store:  
```
artifact_id
workflow_id
task_id
agent_id
artifact_type
created_at
parent_artifact_id
token_count
status
file_path

```
Then the actual artifact remains a small JSON document.  
That gives you something quite powerful:  
**The workflow engine can ask SQLite:**  
“Give me the latest successful research artifact for task X.”  
Then load only that artifact.  
   
⸻  
   
# But there’s an even bigger optimisation  
I’d make the artifact have **two layers**:  
```
Artifact
├── metadata
├── compact summary
└── payload

```
For example:  
```
{
  "id": "research-001",
  "type": "research.result",
  "summary": "Azure is the strongest fit.",
  "confidence": 0.91,
  "payload": {
    "recommendation": "Azure",
    "evidence": [...]
  }
}

```
The next agent can potentially receive only:  
```
summary
confidence
recommendation

```
and retrieve the detailed payload **only if it needs it**.  
That’s effectively **context-aware retrieval between agents**.  
   
⸻  
   
## This could become a really nice pattern for your Agent Workforce  
I’d call the concept something like:  
**Task → Artifact → Context Projection**  
The artifact is the durable truth.  
But before handing it to another agent, the workflow creates a **projection**:  
```
                    Artifact
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
      Research       Analysis      Review
      projection     projection    projection
          │            │            │
          ↓            ↓            ↓
       Agent A       Agent B       Agent C

```
So Agent B doesn’t consume the artifact.  
It consumes **the smallest useful representation of the artifact for Agent B’s task**.  
That is where I think this gets really interesting for the system you’ve been designing.  
**My starting implementation would therefore be:**  
**JSON artifacts + JSONL event log + SQLite metadata/index.**  
No vector DB required initially. No heavyweight state store. It can run completely locally, and later the exact same abstraction could point at Blob Storage, Cosmos DB, PostgreSQL, etc.  
And because you’re already interested in local/offline AI, this would work beautifully on something like your Pi setup too.  
  
Ok, so other than research - let’s say creating a solution, so dev work - what would that look like?  
  
Absolutely. In fact, **software development is probably a better example** of why the artifact pattern matters.  
Instead of having 5 coding agents all looking at the entire repo and conversation, treat development as a sequence of **deliverables**.  
**Example: “Build a customer notification service”**  
Rather than:  
```
User
 ↓
5 agents all inspect repo
 ↓
5 agents independently modify things
 ↓
🤞

```
I’d structure it more like:  
```
                 ┌──────────────┐
                 │  Requirement │
                 └──────┬───────┘
                        ↓
                ┌───────────────┐
                │ Solution      │
                │ Architect     │
                └───────┬───────┘
                        ↓
                  solution.json
                        │
          ┌─────────────┼─────────────┐
          ↓             ↓             ↓
     API Agent       DB Agent      Test Agent
          │             │             │
          └─────────────┼─────────────┘
                        ↓
                  implementation
                        ↓
                  Review Agent
                        ↓
                   PR / commit

```
The important thing is that **each stage creates an artifact that becomes the contract for the next stage.**  
   
⸻  
   
## 1. Requirement artifact  
The first agent turns the vague request:  
“I need a service that sends customers notifications.”  
into something structured:  
```
{
  "type": "solution.requirement",
  "goal": "Customer notification service",
  "requirements": [
    "Send email notifications",
    "Support retry",
    "Track delivery status",
    "Expose HTTP API"
  ],
  "constraints": [
    ".NET",
    "TypeScript frontend",
    "Azure deployment"
  ],
  "acceptance_criteria": [
    "Failed messages retry",
    "Duplicate messages are prevented",
    "Delivery status is queryable"
  ]
}

```
The architect doesn’t need the original conversation anymore.  
It needs **this artifact**.  
   
⸻  
   
## 2. Solution architecture artifact  
Architect agent consumes the requirement artifact.  
It produces:  
```
{
  "type": "solution.architecture",
  "components": [
    {
      "name": "Notification API",
      "technology": ".NET"
    },
    {
      "name": "Message Queue",
      "technology": "Azure Service Bus"
    },
    {
      "name": "Notification Worker",
      "technology": ".NET Worker"
    }
  ],
  "interfaces": [
    {
      "name": "POST /notifications",
      "request": "NotificationRequest",
      "response": "NotificationResponse"
    }
  ],
  "decisions": [
    "Use Service Bus for asynchronous delivery",
    "Use idempotency key to prevent duplicates"
  ]
}

```
Now **three agents can work in parallel**.  
   
⸻  
   
## 3. Split into implementation tasks  
A workflow agent could transform that architecture into:  
```
TASK-001
Create Notification API

TASK-002
Create Service Bus integration

TASK-003
Create Notification Worker

TASK-004
Create persistence layer

TASK-005
Create integration tests

```
Each task has a tiny context:  
```
{
  "task_id": "TASK-001",
  "type": "implementation",
  "component": "Notification API",
  "requirements": [
    "POST /notifications"
  ],
  "interfaces": [
    "NotificationRequest",
    "NotificationResponse"
  ],
  "architecture_ref": "solution-001"
}

```
The coding agent doesn’t need the entire architecture document.  
   
⸻  
   
## 4. The coding agent produces an implementation artifact  
This is where it gets particularly interesting.  
Instead of the agent simply saying:  
“I’ve implemented it.”  
It produces:  
```
{
  "type": "implementation.result",
  "task_id": "TASK-001",
  "status": "complete",
  "files_changed": [
    "src/Notifications/NotificationController.cs",
    "src/Notifications/NotificationRequest.cs"
  ],
  "tests_added": [
    "NotificationControllerTests.cs"
  ],
  "acceptance_criteria": {
    "POST endpoint exists": true,
    "validation implemented": true,
    "tests passing": true
  },
  "commit": "a83f29d"
}

```
That’s a **very powerful boundary**.  
The next agent doesn’t need to inspect everything the coding agent thought about.  
   
⸻  
   
## 5. Now bring in the reviewer  
Reviewer gets:  
```
Requirement artifact
        +
Architecture artifact
        +
Implementation artifact
        +
Git diff

```
Not:  
```
entire conversation
+ entire repo
+ every previous agent's reasoning

```
It can produce:  
```
{
  "type": "code.review",
  "status": "changes_requested",
  "issues": [
    {
      "severity": "high",
      "file": "NotificationController.cs",
      "issue": "Idempotency requirement not implemented"
    }
  ],
  "required_changes": [
    "Implement idempotency handling"
  ]
}

```
That becomes the **next task**.  
   
⸻  
   
## 6. The workflow loops  
Now you have something really interesting:  
```
             ┌─────────────────┐
             │   Architecture  │
             └────────┬────────┘
                      ↓
                 Implementation
                      ↓
                    Tests
                      ↓
                   Review
                      │
                ┌─────┴─────┐
                │           │
              PASS        FAIL
                │           │
                ↓           ↓
             Merge      Fix Task
                            │
                            └──────→ Implementation

```
And **the artifact is what carries state through the loop**.  
   
⸻  
   
## The really important distinction  
I’d actually have **three different kinds of artifacts**.  
**1. Decision artifacts**  
“What are we building and why?”  
```
requirements
architecture
ADRs
design decisions

```
**2. Work artifacts**  
“What has been done?”  
```
implementation result
test result
review result
build result
deployment result

```
**3. Evidence artifacts**  
“How do we know?”  
```
test output
compiler output
lint results
security scan
diff
benchmark
screenshots

```
That gives you:  
```
        DECISIONS
            ↓
         WORK
            ↓
        EVIDENCE
            ↓
         REVIEW
            ↓
        DECISION

```
   
⸻  
   
## And this is where your “skills” idea fits beautifully  
Each agent could have a skill like:  
```
architecture.skill
implementation.skill
testing.skill
code-review.skill
security-review.skill

```
The workflow doesn’t need to know how the agent does its job.  
It simply says:  
**Given artifact X, perform task Y using skill Z and produce artifact type Q.**  
That’s very close to a **manufacturing pipeline for software**.  
```
Requirement
     ↓
Architecture
     ↓
Task Graph
     ↓
┌────────┬────────┬────────┐
│        │        │        │
API     Data     Tests    UI
Agent   Agent    Agent    Agent
│        │        │        │
└────────┴────────┴────────┘
             ↓
          Integration
             ↓
           Review
             ↓
          Evidence
             ↓
          Release

```
And now your original token question becomes much more interesting:  
**The optimisation isn’t “use sequential agents.”**  
It’s:  
**Make every agent consume the minimum artifact projection necessary to perform its task.**  
That gives you a potentially **much more efficient agent workforce**, while also making the whole thing observable, replayable, auditable and capable of running locally.  
That last bit is particularly interesting for the kind of **FlowForge / agent workforce** architecture you’ve been exploring.  
  
So like what I have been doing here: [https://github.com/McFuzzySquirrel/test-mcfuzzy-agent-forge-orchestration/tree/main/docs](https://github.com/McFuzzySquirrel/test-mcfuzzy-agent-forge-orchestration/tree/main/docs)  
  
Yes — **very much like what you’ve already built there.** I looked at the docs directory in your repo, and you already have several of the pieces of the artifact-based approach we were describing.   
Your current structure includes:  
* PRD.md — the **problem/requirements artifact**  
* IDEA.md — the **initial intent/context**  
* WORKFLOW-STATE.json — the **current workflow state**  
* EXECUTION-MANIFEST.json — the **execution plan/contract**  
* EXECUTION-AUDIT.jsonl — the **event/evidence trail**  
* PROGRESS.md — the **human-readable projection of state**  
* prompt-playbook.md — the **agent/task instructions**  
That’s actually quite close to the architecture I was describing.  
**The interesting bit**  
I would now think about your repo like this:  
```
                    IDEA.md
                       │
                       ▼
                    PRD.md
                       │
                       ▼
              EXECUTION-MANIFEST
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           Task A    Task B    Task C
              │        │        │
              └────────┼────────┘
                       ▼
                WORKFLOW-STATE
                       │
                       ▼
              EXECUTION-AUDIT.jsonl
                       │
                       ▼
                  PROGRESS.md

```
So **you’ve already stumbled into the artifact pattern**.  
The thing I’d change is the mental model slightly.  
**Don’t think of these as “documentation”**  
Think of them as **workflow artifacts**.  
That’s a subtle but important difference.  
PRD.md isn’t merely documentation.  
It’s an artifact produced by one stage and consumed by another.  
EXECUTION-MANIFEST.json isn’t merely configuration.  
It’s a **contract between the planning stage and execution stage**.  
WORKFLOW-STATE.json isn’t merely state.  
It’s the **machine-readable current truth**.  
EXECUTION-AUDIT.jsonl isn’t merely logging.  
It’s your **event stream / evidence trail**.  
And PROGRESS.md is essentially a **human-readable projection** of that machine state.  
   
⸻  
   
# And I think you’re onto something particularly interesting  
Your EXECUTION-MANIFEST.json + WORKFLOW-STATE.json + EXECUTION-AUDIT.jsonl combination is arguably more useful than putting everything into a database initially.  
You could evolve it toward:  
```
/workflow
│
├── definition/
│   ├── idea.md
│   └── prd.md
│
├── execution/
│   ├── manifest.json
│   └── state.json
│
├── artifacts/
│   ├── architecture.json
│   ├── implementation.json
│   ├── test-results.json
│   └── review.json
│
├── events/
│   └── execution.jsonl
│
└── projections/
    └── progress.md

```
Now you’ve got a **portable workflow state machine**.  
And because it’s just files, you can:  
* inspect it yourself  
* put it in Git  
* diff it  
* replay it  
* give it to another agent  
* recover after failure  
* run it locally  
* move it to a database later  
This is also broadly consistent with current agent-workflow thinking: Microsoft’s Agent Framework examples explicitly distinguish sequential, concurrent and conditional orchestration, while structured outputs are being used to make routing decisions machine-readable.   
**The thing I’d experiment with next**  
I’d add one concept to your existing Forge:  
```
ARTIFACT

```
Every meaningful agent step must produce one.  
Something like:  
```
{
  "artifact_id": "architecture-001",
  "type": "solution.architecture",
  "produced_by": "architect-agent",
  "task_id": "design-solution",
  "status": "complete",
  "inputs": [
    "prd-001"
  ],
  "outputs": [
    "architecture.json"
  ],
  "consumers": [
    "api-agent",
    "worker-agent",
    "test-agent"
  ]
}

```
Then the orchestrator can determine:  
**What does this agent actually need to see?**  
rather than:  
**What context do I have available?**  
That distinction could be the really interesting core of your experiment.  
**Your Forge isn’t just orchestrating agents. It could be orchestrating the movement of knowledge between agents.**  
And *that* is where I think your token-efficiency question connects directly back to what you’re already building.  
  
Adding this to the execution engine   
  
Yes. Looking at the structure you’ve already built, I **wouldn’t add a completely new orchestration stage**. I’d put the artifact layer **inside the existing execution loop**, between tasks.  
The simplest evolution is:  
```
PRD
 ↓
EXECUTION-MANIFEST
 ↓
TASK
 ↓
┌──────────────────────┐
│ Agent executes task  │
└──────────┬───────────┘
           ↓
     ARTIFACT CREATED
           ↓
   WORKFLOW-STATE updated
           ↓
   AUDIT event recorded
           ↓
      NEXT TASK

```
## 1. Add an   
```
artifacts/

```
**directory**  
I’d add:  
```
docs/
├── PRD.md
├── IDEA.md
├── EXECUTION-MANIFEST.json
├── WORKFLOW-STATE.json
├── EXECUTION-AUDIT.jsonl
├── PROGRESS.md
│
└── artifacts/
    ├── README.md
    ├── architecture/
    ├── implementation/
    ├── testing/
    └── review/

```
But don’t make the agent responsible for deciding where things go.  
**The workflow defines the artifact contract.**  
   
⸻  
   
**2. Add an artifact definition to each task**  
Your existing execution manifest could evolve from something like:  
```
{
  "task_id": "implement-api",
  "agent": "developer",
  "instruction": "Implement the API"
}

```
to:  
```
{
  "task_id": "implement-api",
  "agent": "developer",
  "inputs": [
    "solution.architecture"
  ],
  "produces": [
    "implementation.result"
  ],
  "acceptance": [
    "build succeeds",
    "tests pass"
  ]
}

```
That produces field is the important addition.  
It tells the orchestrator:  
**When this task completes, there must be an artifact of this type.**  
   
⸻  
   
**3. Make the artifact itself small**  
For example:  
```
artifacts/implementation/notification-api-001.json
{
  "artifact_id": "notification-api-001",
  "type": "implementation.result",
  "task_id": "implement-api",
  "status": "complete",

  "summary": "Notification API implemented.",

  "files_changed": [
    "src/Notifications/NotificationController.cs",
    "src/Notifications/NotificationRequest.cs"
  ],

  "tests": {
    "added": 4,
    "passed": 4
  },

  "commit": "abc123",

  "next_actions": []
}

```
Notice what **isn’t** here:  
* agent reasoning  
* entire source files  
* entire conversation  
* massive test output  
* previous context  
Those remain in the repo/logs if needed.  
The artifact is the **compact hand-off**.  
   
⸻  
   
## 4. Then change   
```
WORKFLOW-STATE.json

```
This is where I think your existing architecture becomes really powerful.  
Add something like:  
```
{
  "tasks": {
    "implement-api": {
      "status": "complete",
      "artifact": "notification-api-001"
    },

    "review-api": {
      "status": "ready",
      "inputs": [
        "notification-api-001"
      ]
    }
  }
}

```
Now the workflow engine can determine:  
```
What task am I running?
        ↓
What artifacts does it require?
        ↓
Load those artifacts
        ↓
Project only the required context
        ↓
Run agent
        ↓
Validate output
        ↓
Create artifact
        ↓
Update state

```
   
⸻  
   
## 5. This is where your token optimisation happens  
Suppose your reviewer needs:  
```
PRD
Architecture
Implementation result
Git diff

```
The orchestrator can construct:  
```
REVIEW CONTEXT

Requirement:
    "POST /notifications must support idempotency."

Architecture decision:
    "Use idempotency key."

Implementation:
    "Controller implemented."

Files changed:
    NotificationController.cs

Diff:
    <only relevant diff>

```
Instead of dumping:  
```
Entire agent conversation
+
Entire PRD
+
Entire architecture
+
Entire repo
+
Previous agent output
+
All logs

```
That’s your **context projection**.  
   
⸻  
   
## 6. I’d add one more thing to your audit log  
You already have EXECUTION-AUDIT.jsonl.  
I’d make artifact creation an explicit event:  
```
{
  "event": "artifact.created",
  "timestamp": "...",
  "task_id": "implement-api",
  "agent": "developer",
  "artifact_id": "notification-api-001",
  "artifact_type": "implementation.result",
  "input_artifacts": [
    "architecture-001"
  ]
}

```
Then you can reconstruct the entire knowledge flow:  
```
architecture-001
       │
       ▼
implementation-001
       │
       ▼
test-001
       │
       ▼
review-001
       │
       ├── PASS
       │
       ▼
release-001

```
That’s much more interesting than simply having an agent execution log.  
   
⸻  
   
## And I wouldn’t introduce SQLite yet  
For **your current experiment**, I’d deliberately keep it filesystem-based:  
```
JSON       → state/artifacts
JSONL      → events
Markdown   → human projections
Git        → history/versioning

```
Then later, if the workflow grows to hundreds/thousands of tasks, you can put an index over it.  
The important abstraction is:  
```
ArtifactStore
    ├── FileArtifactStore
    ├── SqliteArtifactStore
    └── BlobArtifactStore

```
So your orchestrator doesn’t care where the artifact lives.  
   
⸻  
   
## The one change I’d make first  
Don’t refactor the whole Forge.  
Take **one existing workflow** in your repo and introduce:  
```
task
 ↓
agent
 ↓
artifact
 ↓
next task

```
Then measure:  
**Before**  
```
Agent B receives:
~X tokens

```
**After**  
```
Agent B receives:
~Y tokens

```
And record that in your audit:  
```
{
  "event": "context.projected",
  "task_id": "review-api",
  "source_tokens": 12480,
  "projected_tokens": 2180,
  "reduction_percent": 82.5
}

```
That would turn your experiment from **“I think artifact-based orchestration is more efficient”** into something you can actually demonstrate.  
And I think that’s a *very* worthwhile next experiment for Agent Forge.  
  
Would this be good for small local agents?  
  
Yes — **arguably even more useful for small local agents**.  
The constraint with a small local model isn’t just inference speed. It’s that you have a much smaller **context window, reasoning capacity, and available compute** than with a large cloud model.  
The artifact approach lets you compensate by making the workflow do more of the organisational work.  
**Think of it like this**  
A small local agent shouldn’t be expected to understand:  
```
entire repo
+ entire conversation
+ requirements
+ architecture
+ previous agents' reasoning
+ test output

```
Instead:  
```
              Workflow
                 │
                 ▼
          Relevant Artifact
                 │
                 ▼
        ┌─────────────────┐
        │ Small Local LLM │
        └────────┬────────┘
                 │
                 ▼
          Small Artifact
                 │
                 ▼
              Workflow

```
The workflow becomes the **memory and coordination layer**, while the small model becomes the **specialist worker**.  
   
⸻  
   
## This opens up a really interesting architecture for your Pi/local AI work  
Imagine a Raspberry Pi running several small models:  
```
                    Agent Forge
                        │
                 Artifact Store
                        │
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   Planning SLM    Coding SLM      Testing SLM
        │               │               │
        └───────────────┼───────────────┘
                        ↓
                  Review SLM

```
Each model could be relatively small because it **doesn’t need to be generally intelligent across the whole problem**.  
It only needs to be good at:  
“Given this artifact, perform this task.”  
That’s a much easier problem.  
   
⸻  
   
**And you can make the artifacts extremely compact**  
For example, instead of giving a coding agent a 20-page architecture document:  
```
{
  "task": "Add retry handling",
  "file": "NotificationWorker.cs",
  "method": "ProcessMessage",
  "requirement": "Retry transient failures 3 times",
  "constraints": [
    "Exponential backoff",
    "Do not retry permanent failures"
  ],
  "tests_required": [
    "transient failure",
    "permanent failure",
    "max retries"
  ]
}

```
That’s an **excellent small-model prompt**.  
The model doesn’t need to understand the whole system.  
   
⸻  
   
## There’s another benefit: specialization  
You could actually choose models based on the artifact/task.  
For example:  
```
Task                         Model
────────────────────────────────────────
Classification               Tiny model
Code search                  Small code model
Simple implementation        Qwen coder
Test generation              Qwen coder
Summarization                Small instruct model
Architecture                 Larger local model
Final review                 Larger/cloud model

```
So instead of:  
“I need one really powerful model to run my agent workforce.”  
you get:  
**“I need a collection of inexpensive specialists coordinated by a deterministic workflow.”**  
That is a much more interesting architecture.  
   
⸻  
   
## And it fits your local-first idea extremely well  
Your local setup could eventually look like:  
```
                 ┌────────────────────┐
                 │    Agent Forge      │
                 │    Orchestrator     │
                 └─────────┬──────────┘
                           │
                    Artifact Store
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
          Tiny SLM      Code SLM     Review SLM
              │            │            │
              └────────────┼────────────┘
                           │
                       Artifacts
                           │
                           ▼
                       Git / Repo

```
And because the artifacts are files, **the whole thing can work offline**.  
That’s one reason I wouldn’t rush to a database.  
   
⸻  
   
**One caveat**  
Don’t over-fragment the work.  
There’s a sweet spot.  
If you turn:  
“Implement authentication”  
into 27 tiny agent tasks, you’ll spend more tokens on orchestration than you save.  
I’d aim for:  
**one agent invocation = one meaningful piece of work producing one useful artifact.**  
For small models, I’d particularly favour:  
**deterministic workflow + tiny context + specialised task + structured artifact**  
rather than trying to make the small model itself act like a sophisticated autonomous agent.  
And honestly, **this may be one of the strongest arguments for your Agent Forge experiment**: you’re effectively moving intelligence *out of the context window and into the workflow*.  
  
About the work I am already doing:  
  
Yes — **this changes my recommendation quite a bit**, because you’re already further along than I realised.  
I read ADR-016. What you’ve built there is not just an execution workflow; you’ve already introduced a **compiler/kernel boundary**. The Forge produces a .workforce package, validates it, maps Forge task IDs to workflow node IDs, and then optionally hands execution to a kernel while preserving state/audit correlation.   
So I would **not add the artifact concept as another major layer**. I’d make it a first-class part of the compiler/workforce contract.  
**Your architecture is becoming this**  
```
                 FORGE
                   │
        requirements / planning
                   │
                   ▼
          EXECUTION-MANIFEST
                   │
                   ▼
        ┌─────────────────────┐
        │ Workforce Compiler  │
        └──────────┬──────────┘
                   │
             .workforce
                   │
                   ▼
             FLOWFORGE
                KERNEL
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
        Agent    Agent    Agent
          │        │        │
          └────────┼────────┘
                   ▼
               ARTIFACTS
                   │
                   ▼
          workflow state/audit

```
And **that last bit is what I think you’re missing today**.  
   
⸻  
   
## Where I’d put the artifact  
Not primarily in the compiler.  
I’d put it in the **workforce execution contract**.  
Your ADR currently says the compiler consumes the manifest and emits agents, skills, workflows and bridge metadata.   
I’d extend the workflow node definition so that a node declares:  
```
{
  "id": "implement-api",
  "agent": "developer",
  "inputs": [
    "solution.architecture"
  ],
  "produces": [
    "implementation.result"
  ]
}

```
Now your kernel knows:  
Before I execute this node, I need to provide the agent with an appropriate projection of solution.architecture.  
And after execution:  
I expect an implementation.result artifact.  
That’s a **much stronger contract** than simply saying “run agent X.”  
   
⸻  
   
## This also fits your compiler idea beautifully  
The compiler can transform:  
```
Forge task
     ↓
Workflow node
     ↓
Artifact contract
     ↓
Runtime invocation

```
For example:  
```
TASK-003
"Implement notification API"

```
becomes:  
```
{
  "node_id": "implement-api",
  "agent": "developer",
  "input_artifacts": [
    {
      "type": "solution.architecture",
      "projection": "implementation"
    }
  ],
  "output_artifacts": [
    {
      "type": "implementation.result"
    }
  ]
}

```
That means the **compiler can enforce the information boundaries**.  
And that’s important for your small local agents.  
   
⸻  
   
## Here’s the really interesting part  
Your existing KERNEL-BRIDGE.json already records things like:  
* workflow state path  
* execution audit path  
* compiled workforce path  
* workflow ID  
* task-to-node mapping  
according to ADR-016.   
I’d add artifact correlation to that boundary.  
Something like:  
```
{
  "task_to_node": {
    "TASK-003": "implement-api"
  },

  "artifact_contract": {
    "TASK-003": {
      "inputs": [
        "architecture-001"
      ],
      "outputs": [
        "implementation-001"
      ]
    }
  }
}

```
Now you have:  
**Forge task → Workforce node → Agent → Artifact**  
That is a very clean chain.  
   
⸻  
   
## And this actually solves the local-agent problem  
Your local agent doesn’t need to know:  
“What happened during the entire workflow?”  
It gets:  
```
Task:
Implement API

Input artifact:
architecture-001

Relevant projection:
API contract
data model
constraints

Produce:
implementation.result

```
That’s it.  
A relatively small model can handle that.  
The **kernel/workflow is doing the orchestration intelligence**, while the local model does the domain work.  
   
⸻  
   
## I would therefore change one thing in your existing design  
You currently have a strong distinction between:  
**Forge generation**  
and  
**kernel execution**  
which I think is absolutely right. Your ADR explicitly calls out keeping those concerns separated.   
I’d introduce a third concept:  
**Artifact contract**  
```
                 FORGE
                   │
             Plan / Compile
                   │
                   ▼
          WORKFORCE PACKAGE
                   │
          ┌────────┴────────┐
          │                 │
      Workflow          Artifacts
      topology          contracts
          │                 │
          └────────┬────────┘
                   ▼
                 KERNEL
                   │
              Agent execution
                   │
                   ▼
                Artifact
                   │
                   ▼
            Next workflow node

```
The artifact isn’t another persistence system.  
It’s a **contract between nodes**.  
   
⸻  
   
## And I’d hold off on SQLite  
Given what you’ve already built, I’d actually make the first implementation:  
```
.workforce/
│
├── workforce.json
├── workflows/
│   └── solution-build.json
│
├── agents/
├── skills/
│
└── artifacts/
    ├── schemas/
    │   ├── solution.architecture.schema.json
    │   ├── implementation.result.schema.json
    │   └── test.result.schema.json
    │
    └── instances/
        ├── architecture-001.json
        ├── implementation-001.json
        └── test-001.json

```
Then your existing audit trail records:  
```
artifact.created
artifact.consumed
artifact.projected
artifact.validated

```
That gives you something I think is **more valuable than simply reducing token usage**:  
**A deterministic information-flow boundary between agents.**  
And that fits *extremely* naturally with the Forge compiler/kernel work you’re already doing.  
In fact, I’d say **ADR-016 is probably the right place to introduce this concept**, rather than creating an entirely separate ADR, because artifact contracts are directly related to what the compiler emits and what the kernel consumes. You could potentially make it **ADR-017: Workforce Artifact Contracts and Context Projection**.  
  
So, this artifact change would apply to the orchestration engine rather that the flow-forge as the agent forge exports this to a .workforce as an option right?   
  
Exactly. **I would put the artifact mechanism primarily in the orchestration/runtime layer, not in Agent Forge itself.**  
Your existing separation actually makes this quite clean.  
```
                    AGENT FORGE
                         │
                  Design / Compile
                         │
                         ▼
                  .workforce package
                         │
              ┌──────────┴──────────┐
              │                     │
         workflow definition    artifact contracts
              │                     │
              └──────────┬──────────┘
                         ▼
                  ORCHESTRATION
                  ENGINE / KERNEL
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           Agent A    Agent B    Agent C
              │          │          │
              ▼          ▼          ▼
          artifact   artifact   artifact
              │          │          │
              └──────────┼──────────┘
                         ▼
                   workflow state

```
**The important distinction**  
**Agent Forge says:**  
“Here is the workforce and how its tasks are related.”  
The .workforce package can therefore *declare* artifact contracts:  
```
{
  "task": "implement-api",
  "inputs": ["solution.architecture"],
  "outputs": ["implementation.result"]
}

```
But **FlowForge/the orchestration kernel says:**  
“Given those contracts, here’s how I actually store, retrieve, project, validate and pass those artifacts between executions.”  
That keeps the responsibilities clean.  
   
⸻  
   
## So I’d split the responsibilities like this  

| Concern                         | Agent Forge | FlowForge / Orchestrator |
| ------------------------------- | ----------- | ------------------------ |
| Define agents                   | ✅           |                          |
| Define skills                   | ✅           |                          |
| Define tasks                    | ✅           |                          |
| Define workflow topology        | ✅           |                          |
| Compile .workforce              | ✅           |                          |
| Declare artifact inputs/outputs | ✅           |                          |
| Store artifacts                 |             | ✅                        |
| Retrieve artifacts              |             | ✅                        |
| Context projection              |             | ✅                        |
| Validate artifact               |             | ✅                        |
| Pass artifact to agent          |             | ✅                        |
| Track artifact lifecycle        |             | ✅                        |
| Audit consumption/creation      |             | ✅                        |
  
So **Forge defines the contract; the orchestration engine implements the contract.**  
   
⸻  
   
**And there’s a really nice consequence**  
Artifact support becomes **optional** from Forge’s perspective.  
A simple workforce could still be:  
```
Task A → Task B → Task C

```
while a more sophisticated workforce could declare:  
```
Task A
  produces ArchitectureArtifact
       ↓
Task B
  consumes ArchitectureArtifact
  produces ImplementationArtifact
       ↓
Task C
  consumes ImplementationArtifact

```
The same .workforce format supports both.  
And FlowForge can decide how sophisticated the execution strategy needs to be.  
   
⸻  
   
# I would actually make the   
```
.workforce

```
## contract deliberately storage-agnostic  
Something like:  
```
{
  "artifacts": {
    "architecture": {
      "type": "solution.architecture",
      "schema": "schemas/solution.architecture.json"
    },
    "implementation": {
      "type": "implementation.result",
      "schema": "schemas/implementation.result.json"
    }
  }
}

```
Then a task references those logical artifacts:  
```
{
  "id": "implement-api",
  "inputs": ["architecture"],
  "outputs": ["implementation"]
}

```
FlowForge decides whether those artifacts live in:  
```
local filesystem
       ↓
SQLite
       ↓
Redis
       ↓
Azure Blob
       ↓
Postgres

```
The workforce doesn’t care.  
   
⸻  
   
## And this fits your Forge → Kernel handoff really well  
You essentially end up with:  
```
              McFuzzy Agent Forge
                       │
                       │ compile
                       ▼
                  .workforce
                       │
          ┌────────────┴────────────┐
          │                         │
       topology                contracts
          │                         │
          └────────────┬────────────┘
                       │
                       ▼
                 FlowForge
                  Kernel
                       │
               ┌───────┴───────┐
               │               │
          Context          Execution
          projection        control
               │               │
               └───────┬───────┘
                       ▼
                    Agents

```
That makes **FlowForge more than an agent runner**.  
It becomes the **execution and information-flow runtime for a compiled workforce**.  
And I think that’s actually a stronger architectural story than putting all of this inside Agent Forge.  
**Forge = compiler / workforce authoring**  
****.workforce = portable execution package****  
**FlowForge = runtime/kernel**  
**Artifacts = the information contracts flowing through the runtime**  
That separation also means you could eventually have *another* orchestration engine consume the .workforce package without needing to adopt your artifact storage implementation — which is exactly the kind of clean boundary you want from the compiler/kernel approach.  
  
But what if the user wants to use a different harness, would it then not make more sense to have it in the orchestration engine?  
  
Yes — **that’s the stronger architecture**.  
If Agent Forge can export a .workforce that can be consumed by **different harnesses/runtimes**, then the artifact concept should be part of the **workforce/orchestration contract**, while the *implementation* of artifact storage/context projection belongs to whichever orchestration engine is executing it.  
The key is separating **contract from implementation**.  
```
                    Agent Forge
                        │
                        │ compile
                        ▼
                  .workforce
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
      FlowForge     Harness B      Harness C
          │             │             │
          ▼             ▼             ▼
    ArtifactStore  ArtifactStore  ArtifactStore
          │             │             │
          ▼             ▼             ▼
       Agents         Agents        Agents

```
**So I would actually make three layers**  
**1. Agent Forge — authoring/compiler**  
Defines:  
* agents  
* skills  
* tasks  
* workflow topology  
* dependencies  
* artifact **types/contracts**  
* schemas  
* expected inputs/outputs  
It exports these into .workforce.  
**2. .workforce — portable contract**  
Contains something like:  
```
{
  "task": "implement-api",
  "inputs": [
    {
      "artifact": "solution.architecture",
      "required": true
    }
  ],
  "outputs": [
    {
      "artifact": "implementation.result",
      "schema": "schemas/implementation.result.json"
    }
  ]
}

```
Crucially, it doesn’t say:  
Store this in SQLite.  
or:  
Use FlowForge’s artifact service.  
It simply says:  
This task consumes this artifact and produces that artifact.  
**3. Harness/orchestration engine — execution**  
This is where the actual machinery lives:  
```
ArtifactStore
ArtifactResolver
ContextProjector
ArtifactValidator
ArtifactLifecycle

```
So FlowForge might implement:  
```
FileArtifactStore

```
while another harness might use:  
```
PostgresArtifactStore

```
and another might use:  
```
Azure BlobArtifactStore

```
But they all satisfy the same conceptual contract.  
   
⸻  
   
## And there’s an important distinction between “artifact” and “context”  
I think this is where your design could become really elegant.  
The **artifact is durable workflow state**.  
The **context projection is runtime-specific**.  
For example:  
```
Architecture Artifact
        │
        ├───────────────┐
        ↓               ↓
 FlowForge           Harness B
 projection           projection
        │               │
        ↓               ↓
 Local SLM           Cloud Agent

```
The artifact might be:  
```
{
  "type": "solution.architecture",
  "components": [...],
  "decisions": [...]
}

```
FlowForge might give a small local model:  
```
Only API contract + relevant decisions

```
Another harness might give Claude:  
```
Architecture + relevant repository files

```
**Same artifact. Different projection.**  
That’s a really important portability property.  
   
⸻  
   
# This also changes how I’d think about your   
```
.workforce

```
I’d make it something closer to an **interchange format for agent workforces**.  
Similar conceptual idea to:  
```
Source code
    ↓
Compiler
    ↓
Portable executable/package
    ↓
Different runtimes

```
Your model becomes:  
```
Agent Forge
    ↓
Workforce Compiler
    ↓
.workforce
    ↓
┌──────────┬──────────┬──────────┐
│ FlowForge │ Harness B│ Harness C│
└──────────┴──────────┴──────────┘

```
And the artifact contract travels **with the workforce**.  
   
⸻  
   
## Which means I would   
## not  
## call this “FlowForge artifacts”  
I’d call it something neutral:  
**Workforce Artifacts**  
or perhaps:  
**Execution Artifacts**  
Then FlowForge has an implementation of the artifact runtime.  
That prevents your .workforce format from becoming accidentally coupled to your own kernel.  
   
⸻  
   
**And this gives you a really strong division:**  
**Forge defines what information must flow between tasks.**  
**The harness determines how that information flows at runtime.**  
That’s exactly what you want if someone says:  
“I like Agent Forge, but I want to execute my workforce using LangGraph / Microsoft Agent Framework / Dapr / my own runtime.”  
They shouldn’t have to adopt FlowForge’s storage or context-management architecture.  
They consume the .workforce, implement the required runtime interfaces, and they’re good to go.  
And **that makes the compiler/kernel handoff in ADR-016 even more important**, rather than less. The kernel is an *optional execution target*, while the .workforce is the portable representation of the workforce and its contracts.  
  
