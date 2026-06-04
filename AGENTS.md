\# AGENTS.md



\## Purpose



This repository contains the Tournament Registration System (TRS).



The system consists of:



\* frontend/ (React + TypeScript)

\* backend/ (ASP.NET Core + Entity Framework Core + SQL Server)



Always prioritize correctness, maintainability, and minimal risk.



\---



\## Before Making Changes



First provide:



1\. Understanding of the request

2\. Files likely to be modified

3\. Potential risks

4\. Proposed implementation plan



Do not immediately start coding when requirements are ambiguous.



Ask questions when business rules are unclear.



\---



\## Change Scope



Only modify files directly related to the requested task.



Do NOT:



\* Refactor unrelated code

\* Rename files unnecessarily

\* Reorganize folders

\* Change coding style across the project

\* Modify unrelated components



Keep changes focused and surgical.



\---



\## Existing Patterns First



Prefer:



\* Existing services

\* Existing repositories

\* Existing components

\* Existing API patterns



Avoid introducing new frameworks, patterns, or abstractions unless there is a clear justification.



\---



\## Database Safety



Treat database changes as high risk.



Before generating migrations:



\* Explain the impact

\* Explain rollback strategy

\* Explain affected tables



Never:



\* Drop tables

\* Drop columns

\* Delete production data



without explicit approval.



\---



\## API Safety



Preserve existing API contracts whenever possible.



Before changing request or response models:



\* Explain breaking changes

\* Identify affected frontend screens

\* Suggest backward-compatible alternatives



\---



\## Authentication \& Authorization



Preserve existing:



\* JWT authentication

\* Role-based authorization

\* Permission behavior



Do not modify authentication flows unless explicitly requested.



\---



\## Payment Safety



Payment-related functionality is considered critical.



Before modifying payment flows:



\* Explain business impact

\* Identify affected scenarios

\* List required validation tests



Never bypass payment validation without explicit requirements.



\---



\## Business Rules



Never assume business rules.



If uncertain about:



\* Registration flow

\* Tournament rules

\* Ranking calculations

\* Seeding logic

\* Admin overrides

\* Payment requirements



Ask for clarification.



\---



\## Code Quality



Generated code must:



\* Compile successfully

\* Follow existing project conventions

\* Avoid placeholder implementations

\* Avoid TODO-only solutions

\* Be production-ready



\---



\## Testing



For every change provide:



\### Happy Path



Expected successful behavior.



\### Validation Cases



Expected validation failures.



\### Edge Cases



Important boundary conditions.



\---



\## Output Format



After implementation provide:



1\. Summary of changes

2\. Files modified

3\. Database impact

4\. API impact

5\. Testing checklist



\---





