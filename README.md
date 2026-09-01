# Turing Tutor (JISC / South Devon College)

> **Empowering students to use Generative AI responsibly through real-time pedagogical assessment, automated integrity referencing, and advanced cognitive analytics.**

Turing Tutor is an intelligent tutoring and academic integrity platform developed in collaboration with **South Devon College** and **Jisc**. Built to align with **JCQ (Joint Council for Qualifications) AI Guidelines** and UK vocational specifications (such as Cambridge Advanced National / AAQ Human Biology), Turing Tutor bridges the gap between generative AI capabilities and rigorous academic honesty.

Instead of acting as a passive answer generator, Turing Tutor continuously assesses prompt interactions, scaffolds critical thinking, encourages human-driven editing, automatically generates assessment-ready citation snapshots, and evaluates coursework drafts against official assessment criteria.

---

## 📑 Table of Contents

- [Overview & Pedagogical Philosophy](#-overview--pedagogical-philosophy)
- [Key Features](#-key-features)
  - [1. 5-Tier Real-Time AI Assessment Scale](#1-5-tier-real-time-ai-assessment-scale)
  - [2. Turing Mode & Academic Workspace](#2-turing-mode--academic-workspace)
  - [3. Decipher Assessment Engine](#3-decipher-assessment-engine)
  - [4. Academic Citation & Visual Evidence Generator](#4-academic-citation--visual-evidence-generator)
  - [5. AI Analytics & Statistical Significance Suite](#5-ai-analytics--statistical-significance-suite)
  - [6. Real-Time Streaming Chat & Organisation](#6-real-time-streaming-chat--organisation)
- [System Architecture & Tech Stack](#-system-architecture--tech-stack)
- [Database Schema & Security Hardening](#-database-schema--security-hardening)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation & Local Setup](#installation--local-setup)
  - [Environment Configuration](#environment-configuration)
  - [Database Migration & RLS Bootstrap](#database-migration--rls-bootstrap)
- [API & WebSocket Specification](#-api--websocket-specification)
- [Deployment Options](#-deployment-options)
- [Academic Integrity & JCQ Compliance](#-academic-integrity--jcq-compliance)
- [License & Acknowledgements](#-license--acknowledgements)

---

## 🧠 Overview & Pedagogical Philosophy

Generative AI offers tremendous learning opportunities, but uncontrolled use risks bypassing student cognition and violating academic integrity standards. Turing Tutor solves this by implementing active pedagogical guardrails:

```
+-----------------------------------------------------------------------------------+
|                               TURING TUTOR WORKFLOW                                |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [ Student Prompt ] ---> [ Real-Time AI Scale Assessment (Levels 1 - 5) ]         |
|                                         |                                         |
|                                         +---> If Level >= 3 (High AI Reliance):   |
|                                         |     - Message Auto-Collapses            |
|                                         |     - Alternative Prompt Recommended     |
|                                         v                                         |
|  [ Streaming AI Response ] ---> [ Turing Mode / Drafting Workspace ]              |
|                                         |                                         |
|       +---------------------------------+---------------------------------+       |
|       |                                                                   |       |
|       v                                                                   v       |
|  [ Decipher Assessment ]                                            [ Reference ] |
|  - Evaluates P1/P2/M2/D1 Criteria                                   - APA / Harvard|
|  - Steampunk Cogwheel UI                                            - PNG Evidence|
|  - Actionable Pass/Merit Feedback                                   - Drag & Drop |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

1. **Scaffold, Don't Solve**: Prompts that ask AI to do the work (Level 5 - Full AI) trigger pedagogical alternative prompts (e.g., suggesting research or structural outlining instead).
2. **Discourage Blind Copying**: High-reliance AI responses automatically collapse in the UI to require intentional review and prevent copy-paste habits.
3. **Transparent Provenance**: Students can drag and drop prompts to generate formatted Harvard/APA citations and graphical image evidence for their coursework submissions.
4. **Authentic Assessment**: Turing Mode embeds the unit specification and evaluates student writing iteratively against grading rubrics.

---

## ✨ Key Features

### 1. 5-Tier Real-Time AI Assessment Scale
Every user prompt is classified in real time across a 5-point pedagogical continuum based on established academic AI frameworks:

| Level | Classification | Description | System Behavior |
| :--- | :--- | :--- | :--- |
| **Level 1** | **No AI** | Purely human-driven queries; zero generative dependence. | Standard display, logged to analytics. |
| **Level 2** | **Ideas & Structure** | Brainstorming, outlining, structuring, or exploring concepts. | Encouraged learning tier; active assistance. |
| **Level 3** | **AI Editing** | Refining grammar, improving tone, clarity, and phrasing. | Generates coaching feedback; UI collapse triggers. |
| **Level 4** | **AI + Human Evaluation** | Collaborative iterative content creation with active critique. | AI feedback provided; monitoring flagged. |
| **Level 5** | **Full AI** | Direct generative requests ("write my essay", "produce paragraph"). | Generates **Alternative Prompt**; collapses response. |

- **Real-Time Classification**: Utilizes heuristic filters and OpenAI/Azure OpenAI models (`gpt-4o`) to classify prompts instantaneously.
- **Supportive Prompt Alternatives**: When Level 3–5 behavior is detected, the tutor offers supportive prompt alternatives (max 50 words) to guide the student back toward structural brainstorming or research.

---

### 2. Turing Mode & Academic Workspace
A specialized, distraction-free coursework workspace designed for academic writing:
- **In-Place Rich Content Editor**: Directly edit and format assistant text, student drafts, and research notes (headings, bold, italic, underline, color swatches).
- **Embedded Unit Specification PDF Viewer**: In-app modal viewer displaying the complete **Cambridge Advanced National (AAQ) in Human Biology** (Unit F217: *Biomedical Techniques*) specification.
- **Criteria Guidance Rail**: Interactive criteria chips (**P1, P2, M2, D1**) displaying assessment guidelines on hover with synchronized visual animations.
- **Safe Persistence**: Edits, removed footers, citations, and metadata are persisted automatically in PostgreSQL JSONB fields.

---

### 3. Decipher Assessment Engine
A formative grading tool for vocational assignments:
- **Rubric-Aligned Feedback**: Scans the student's draft (excluding reference appendices) against specific qualification criteria:
  - **P1**: Research and identify potential diseases for patients ($\ge 4$ diseases).
  - **P2**: Step-by-step investigation method, equipment, quantities, and PPE.
  - **M1/M2**: Diagnostic rationale, hypotheses, and symptom analysis.
  - **D1**: Justification of equipment settings and advanced methodologies.
- **Steampunk Cogwheel Interface**: Features an animated, dual-rotating vintage Turing-Enigma gear overlay with status indicators during grading computation.
- **Actionable Output**: Concise status breakdowns with targeted Pass/Merit/Distinction recommendations.

---

### 4. Academic Citation & Visual Evidence Generator
Enables seamless, JCQ-compliant AI usage declarations:
- **Drag-and-Drop Workflow**: Drag any user prompt bubble onto the metallic transmission gear / reference drop zone.
- **Instant Citation Formatting**: Generates standardized academic reference text:
  ```text
  OpenAI. (2025). ChatGPT (GPT-4) [Large language model]. Prompt: "..." Accessed: 1 September 2026.
  ```
- **High-Resolution Visual Export**: Powered by `html2canvas`, captures pixel-perfect rendered dialog boxes:
  - **Copy Prompt + AI as Image**: Direct PNG copy to system clipboard.
  - **Download PNG**: Instant graphic download (`chat-snippet.png`) for portfolio evidence.

---

### 5. AI Analytics & Statistical Significance Suite
A comprehensive analytics modal (`#analytics-modal`) accessible from the sidebar navigation:

#### Overview Metrics
- Filterable across **7 Days**, **30 Days**, or **All-Time**.
- Summary metric cards: Total Prompts, Average AI Level, Most Frequent Level, and AI Reliance Risk Index.
- Custom Canvas Time-Series Line Chart & Donut Distribution Chart.

#### Advanced Statistical Significance Testing
For educational researchers and self-monitoring students:
1. **Ordinary Least Squares (OLS) Linear Regression**:
   - Calculates trendline slope ($\beta_1$), intercept ($\beta_0$), Pearson correlation coefficient ($r$), coefficient of determination ($R^2$), and standard error.
   - Computes two-tailed $t$-distribution $p$-value ($H_0: \beta_1 = 0$) to verify if AI reliance is statistically declining or increasing over time.
2. **Welch’s Two-Sample $t$-Test (Split-Half Temporal Test)**:
   - Divides user prompt history into early vs. late periods.
   - Evaluates unequal variances, Welch-Satterthwaite degrees of freedom ($df$), Cohen’s $d$ effect size, and significance ($p < 0.05$).
3. **Mann-Kendall Monotonic Trend Test & Sen’s Slope**:
   - Non-parametric trend test for ordinal AI scale data.
   - Computes Kendall's $S$ statistic, tie corrections, $Z$-score, Sen’s median slope estimator, and two-tailed normal $p$-value.
- **Privacy First**: Analytics data is computed client-side and saved securely in `localStorage` with a 1-click wipe option.

---

### 6. Real-Time Streaming Chat & Organisation
- **WebSocket & SSE Streaming**: Low-latency token-by-token streaming with automatic fallback.
- **AI Session Titling**: Automatic Azure/OpenAI session titling (3–5 words) generated on the first prompt exchange.
- **Custom Groups / Folders**: Create, rename, delete, and drag-and-drop sessions into custom modules/units.
- **Keyboard Shortcuts**: Rapid new chat creation via `⌘K` / `Ctrl+K`.

---

## 🏗 System Architecture & Tech Stack

```
                     +---------------------------------------+
                     |         Browser Client (UI)          |
                     | Vanilla JS, CSS3, HTML5, html2canvas  |
                     +---------------------------------------+
                                    |         ^
                       HTTP / REST  |         |  WebSocket (ws://)
                       & SSE Stream |         |  Bi-directional Events
                                    v         |
                     +---------------------------------------+
                     |       Node.js / Express Server        |
                     |  - Express Session & CSRF (csurf)     |
                     |  - Helmet & Strict CSP Policies       |
                     |  - Rate Limiters (Auth + API)         |
                     |  - AsyncLocalStorage User Context     |
                     +---------------------------------------+
                           |                     |
          Azure / OpenAI   |                     | PostgreSQL Pool
          Chat Completions |                     | (Row-Level Security)
                           v                     v
                +--------------------+   +-----------------------+
                | GPT-4 / GPT-4o /   |   | PostgreSQL Database   |
                | Azure OpenAI API   |   | - app_user, session   |
                | (Streaming & SSE)  |   | - message, feedback   |
                +--------------------+   | - scale_level, groups |
                                         +-----------------------+
```

### Core Technologies
- **Runtime & Backend**: Node.js (`>=18 <21`), Express 4, ES Modules (`"type": "module"`).
- **Real-Time Communication**: `ws` (WebSockets) for bidirectional chat & state updates; Server-Sent Events (SSE) for serverless streaming.
- **Database Layer**: PostgreSQL (`pg`) with Row-Level Security (RLS) enforcement and JSONB metadata; legacy SQLite support (`sqlite3`).
- **AI Models**: OpenAI API (`gpt-4`, `gpt-4o`) & Azure OpenAI Service (`gpt-4.1` / custom deployments).
- **Security & Middleware**: `bcrypt` (12 rounds), `express-session`, `csurf` (cookie-based CSRF), `helmet`, `express-rate-limit`, `express-validator`.
- **Frontend**: Vanilla JavaScript (no heavy frontend framework dependencies), Canvas API, SVG animations, Google Fonts (*Inter*).

---

## 🔒 Database Schema & Security Hardening

### Entity Relationship Model

```sql
+----------------+       +-------------------+       +-------------------+
|    app_user    |       |      session      |       |      message      |
+----------------+       +-------------------+       +-------------------+
| id (PK)        |<----->| id (PK)           |<----->| id (PK)           |
| username       |       | user_id (FK)      |       | session_id (FK)   |
| password_hash  |       | session_name      |       | role (user/asst)  |
+----------------+       | group_id          |       | content           |
                         | is_turing (bool)  |       | collapsed (bool)  |
                         | created_at (tz)   |       | scale_level (int) |
                         | updated_at (tz)   |       | references_json   |
                         +-------------------+       | prompts_json      |
                                                     | footer_removed    |
                                                     | created_at (tz)   |
                                                     +-------------------+
```

### Row-Level Security (RLS) Implementation
All database queries run within an `AsyncLocalStorage` context that binds the authenticated user ID. Before query execution, the database sets a session-local GUC:

```sql
SELECT set_config('app.current_user_id', $1::text, false);
```

Postgres policies prevent cross-tenant data leakage:
- **`session` Policy**: `user_id = current_setting('app.current_user_id')::int`
- **`message` Policy**: `EXISTS (SELECT 1 FROM session WHERE session.id = message.session_id AND session.user_id = current_setting('app.current_user_id')::int)`
- **`app_admin` Helper Role**: A restricted role used exclusively for non-authenticated bootstrap operations (registration, password migration).

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v18.x` or `v20.x` (see `.nvmrc`)
- **PostgreSQL**: `v14+` (or Docker for local containerization)
- **OpenAI API Key** or **Azure OpenAI Endpoint**

### Installation & Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/TuringTutorApp_JISC.git
   cd TuringTutorApp_JISC
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start local PostgreSQL (via Docker Compose)**:
   ```bash
   docker compose up -d
   ```
   *This starts a PostgreSQL 15 container mapped to `localhost:5432` with user `turing`, password `turingpass`, and database `turingdb`.*

4. **Initialize Database Schema**:
   ```bash
   # Apply core schema and RLS policies
   psql -h localhost -U turing -d turingdb -f migrations/postgres_schema.sql

   # Apply incremental migrations
   psql -h localhost -U turing -d turingdb -f migrations/20251101_add_message_metadata.sql
   psql -h localhost -U turing -d turingdb -f migrations/20251204_add_footer_removed.sql
   psql -h localhost -U turing -d turingdb -f migrations/20251204_add_timestamps.sql
   psql -h localhost -U turing -d turingdb -f migrations/20251209_add_session_created_at.sql
   ```

5. **Bootstrap `app_admin` role**:
   ```bash
   npm run db:create-app-admin
   ```

---

### Environment Configuration

Create a file named `APIkey.env` in the repository root:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
SESSION_SECRET=replace_with_a_secure_long_random_entropy_string

# PostgreSQL Database Connection
DATABASE_URL=postgresql://turing:turingpass@localhost:5432/turingdb

# OpenAI API Configuration (Standard)
OPENAI_API_KEY=sk-proj-...

# Azure OpenAI Configuration (Optional / Vercel Serverless)
AZURE_OPENAI_ENDPOINT=https://your-azure-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-15-preview
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_MODEL=gpt-4o

# HTTPS / TLS (Optional for Local Development)
# HTTPS_ENABLED=true
# SSL_KEY_PATH=./localhost+2-key.pem
# SSL_CERT_PATH=./localhost+2.pem
```

---

### Running the Application

```bash
npm start
```

The application will start on `http://localhost:3000`. If port 3000 is occupied, the server automatically searches for the next available port.

Run the automated smoke test suite to verify endpoints and authentication:
```bash
node scripts/smoke_test.js
```

---

## 📡 API & WebSocket Specification

### Authentication & Core REST Routes

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `GET` | `/csrf-token` | Returns CSRF token for subsequent mutating requests. | No |
| `POST` | `/register` | Register new student account (bcrypt hashed). | No |
| `POST` | `/login` | Authenticate student and establish session cookie. | No |
| `POST` | `/logout` | Destroy session and clear cookies. | Yes |
| `GET` | `/sessions` | Fetch all chat sessions belonging to the user. | Yes |
| `POST` | `/start-session` | Create a new standard conversation session. | Yes |
| `POST` | `/start-turing` | Initialize a dedicated Turing Mode drafting session. | Yes |
| `POST` | `/rename-session`| Rename an existing session title. | Yes |
| `DELETE`| `/delete-session`| Permanently delete a session and all its messages. | Yes |
| `GET` | `/messages` | Retrieve full message history for a given `session_id`. | Yes |
| `POST` | `/update-message`| Update message content, references, and prompt metadata. | Yes |
| `POST` | `/upload-image` | Upload user screenshot/image (10MB max, data URL check). | Yes |
| `GET` | `/groups` | Retrieve user's session groups/folders. | Yes |
| `POST` | `/create-group` | Create a new group folder. | Yes |

### WebSocket Protocol (`ws://localhost:3000`)

Clients connect with session cookies. Messages are exchanged in JSON:

#### Client $\rightarrow$ Server
- **Send Prompt**: `{ "session_id": 12, "content": "Explain PCR testing in biology." }`
- **Decipher Request**: `{ "action": "generateFeedback", "content": "<html draft>", "session_id": 12 }`
- **Fetch History**: `{ "session_id": 12 }`

#### Server $\rightarrow$ Client
- **Token Chunk**: `{ "type": "assistant", "content": "Polymerase...", "format": "html" }`
- **Scale Level**: `{ "type": "scale", "data": [2] }`
- **Feedback / Alternative**: `{ "type": "feedback", "content": "Try asking...", "format": "markdown" }`
- **Auto-Rename**: `{ "type": "session-renamed", "session_id": 12, "title": "PCR Diagnostics" }`
- **Persisted ID**: `{ "type": "message-saved", "message_id": 842 }`

---

## 🚢 Deployment Options

### 1. Docker Production Deployment
A production-ready `docker-compose.yml` is provided for containerized database services. For full app containerization, bundle Node.js with the `DATABASE_URL` pointing to your managed Postgres cluster.

### 2. Vercel Serverless Deployment
Turing Tutor includes dedicated Vercel serverless handlers in the `api/` directory:
- `/api/chat`: Server-Sent Events (SSE) streaming chat completions with Azure OpenAI.
- `/api/decipher`: Coursework draft rubric assessor.
- `/api/generate-title`: Auto-titling helper.
- `/api/upload-image`: Serverless media upload endpoint.

Deploy directly using the Vercel CLI:
```bash
vercel --prod
```

---

## 🎓 Academic Integrity & JCQ Compliance

Turing Tutor is engineered specifically to help further and higher education institutions meet the requirements of the **JCQ (Joint Council for Qualifications) AI Use in Assessments Guidelines**:

1. **Authentication of Student Work**: By tracking prompt evolution, students can demonstrate genuine learning and originality.
2. **Transparent Record of AI Interaction**: One-click generation of APA/Harvard references and cryptographic timestamped visual captures makes acknowledging AI assistance frictionless.
3. **Misuse Prevention**: Automatic detection and redirection of Level 5 "Full AI" prompts discourages direct plagiarism before text is generated.

---

## 📜 License & Acknowledgements

- **Project Lead**: Daniel Tagg
- **Institutional Partners**: **South Devon College** & **Jisc (National Centre for AI in Tertiary Education)**
- **License**: ISC License

---

*For inquiries, technical support, or pedagogical research collaborations regarding Turing Tutor, please contact South Devon College.*
