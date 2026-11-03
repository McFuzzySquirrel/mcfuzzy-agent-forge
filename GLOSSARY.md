# Forge Console

The user-facing workspace for taking a project idea through an agreed brief and into a build.

## Project language

**Idea**:
The initial intent, problem, or opportunity a user wants a project to address.
_Avoid_: implementation plan

**Project**:
The workspace for developing an idea into a defined outcome and carrying that work forward.
_Avoid_: pipeline

**Project brief**:
The agreed description of a project's intended outcome, audience, capabilities, scope, success criteria, assumptions, and open questions.
_Avoid_: PRD (in basic-user-facing copy), task list

**Project files**:
The user-facing collection of a project's important documents and deliverables.
_Avoid_: artifacts

**Task**:
A bounded unit of work in a project, performed by an agent or requiring a human decision.
_Avoid_: to-do

**Next responsible**:
The person or agent expected to take the next meaningful action for a Task.
_Avoid_: owner (when referring to who acts next)

**Human review**:
A task in which a person checks stated criteria, records evidence, and makes an explicit approval decision.
_Avoid_: sign-off

**Build**:
The execution of work intended to deliver an approved Project brief.
_Avoid_: preparation

**AI coding tool**:
The supported AI development environment a person chooses for a Project's authoring and Build work.
_Avoid_: harness (in Basic-user-facing copy)

**Feature addition**:
A follow-on change that expands an existing Project's agreed capabilities; its added work is reviewed before it runs.
_Avoid_: feature increment, increment the project

## Project lifecycle

**New Project**:
A Project workspace with no saved Idea or Project brief work yet.

**Partially authored**:
A Project with saved but unfinished Idea or Project brief work.

**Needs your review**:
A Project brief that is ready for a person's explicit review and approval.

**Preparing**:
A Project whose brief has been approved and is being prepared for a Build; execution has not started.

**Ready to start build**:
A Project whose preparation is complete and is waiting for the user to explicitly start the Build.

**Running**:
A Project whose Build execution has started and is underway.

**Blocked**:
A Project whose next meaningful step cannot proceed without user action.

**Failed**:
A Project whose authoring, preparation, or Build work ended unsuccessfully; recovery depends on what failed.

**Completed**:
A Project whose Build execution has finished and whose Project files are ready to review.
