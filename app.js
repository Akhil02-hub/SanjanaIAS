/* SanjanaIAS — single-file application.
   Sections:
     1. Illustrations (inline SVG data URIs)
     2. Seed data (news, sources, syllabus, questions)
     3. Utilities
     4. Storage
     5. RSS / Classifier / Dedupe / Relevance (also used by the collector under Node)
     6. Search engine
     7. Renderers (card, listRow, chips)
     8. Article renderer
     9. Tutor, Revision
    10. Page functions
    11. Shell wiring + router + boot
    12. Exports (for the Node collector)                                         */
(function (root) {
    'use strict';

    var SUPABASE_URL = 'https://lbcxwmyppnmnezyxyvon.supabase.co';
    var SUPABASE_ANON_KEY = 'sb_publishable_8acY7UihRJ2tSpW3zmFDUA_n24G5Ayq';
    var supabaseClient = null;
    if (typeof supabase !== 'undefined' && supabase.createClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,      // Saves the login to localStorage
                autoRefreshToken: true,    // Keeps the login alive in the background
                detectSessionInUrl: true   // Handles magic links (if used later)
            }
        });
    }

    var SI_AUTH = {
        user: null,
        ready: false,
        listeners: [],

        onChange: function (fn) { SI_AUTH.listeners.push(fn); },
        _emit: function () { SI_AUTH.listeners.forEach(function (f) { try { f(SI_AUTH.user); } catch (e) { } }); },

        init: async function () {
            if (!supabaseClient) { SI_AUTH.ready = true; return null; }
            try {
                var s = await supabaseClient.auth.getSession();
                SI_AUTH.user = (s && s.data && s.data.session) ? s.data.session.user : null;
                supabaseClient.auth.onAuthStateChange(function (_event, session) {
                    SI_AUTH.user = session ? session.user : null;
                    SI_AUTH._emit();
                });
            } catch (e) { /* offline */ }
            SI_AUTH.ready = true;
            return SI_AUTH.user;
        },

        username: function () {
            if (!SI_AUTH.user) return null;
            var email = SI_AUTH.user.email || '';
            var m = email.match(/^(.*)@sanjana\.local$/);
            if (m) return m[1];
            return email.split('@')[0] || 'User';
        },

        signUp: async function (username, password, sq, sa) {
            if (!supabaseClient) return { error: 'Auth is not configured.' };
            if (username.length < 3) return { error: 'Username must be at least 3 characters.' };
            if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
            if (!sq || !sa) return { error: 'Security question and answer are required.' };

            var email = username.includes('@') ? username.toLowerCase() : username.toLowerCase() + '@sanjana.local';
            var r = await supabaseClient.auth.signUp({ email: email, password: password });
            if (r.error) return { error: 'Could not create account. Try a different username.' };

            var sess = await supabaseClient.auth.getSession();
            if (!sess.data.session) {
                var lr = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
                if (lr.error) return { error: 'Account created, but please log in.' };
            }
            var pr = await supabaseClient.rpc('create_profile', {
                p_username: username.toLowerCase(),
                p_sq: sq,
                p_sa: sa
            });
            if (pr.error) return { error: 'Account created, but profile setup failed. Contact admin.' };
            SI_AUTH.user = (await supabaseClient.auth.getSession()).data.session.user;
            try {
                localStorage.removeItem('sanjana.guest_quiz');
                localStorage.removeItem('sanjana.guest_tutor');
            } catch (e) { }
            SI_AUTH._emit();
            return { ok: true };
        },

        signIn: async function (username, password) {
            if (!supabaseClient) return { error: 'Auth is not configured.' };
            var email = username.includes('@') ? username.toLowerCase() : username.toLowerCase() + '@sanjana.local';
            var r = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
            if (r.error) return { error: 'Username or password is incorrect.' };
            SI_AUTH.user = r.data.user;
            try {
                localStorage.removeItem('sanjana.guest_quiz');
                localStorage.removeItem('sanjana.guest_tutor');
            } catch (e) { }
            SI_AUTH._emit();
            return { ok: true };
        },

        signOut: async function () {
            if (supabaseClient) await supabaseClient.auth.signOut();
            SI_AUTH.user = null;
            SI_AUTH._emit();
        },

        getSecurityQuestion: async function (username) {
            if (!supabaseClient) return null;
            var r = await supabaseClient.rpc('get_security_question', { p_username: username.toLowerCase() });
            return r.error ? null : r.data;
        },

        verifyAnswer: async function (username, answer) {
            if (!supabaseClient) return false;
            var r = await supabaseClient.rpc('verify_security_answer', { p_username: username.toLowerCase(), p_answer: answer });
            return !r.error && r.data === true;
        },

        resetPassword: async function (username, answer, newPassword) {
            if (!supabaseClient) return { error: 'Auth is not configured.' };
            if (newPassword.length < 8) return { error: 'Password must be at least 8 characters.' };
            var r = await supabaseClient.functions.invoke('reset-password', {
                body: { username: username.toLowerCase(), answer: answer, new_password: newPassword }
            });
            if (r.error || !r.data || !r.data.ok) return { error: 'Reset failed. Check your answer.' };
            return { ok: true };
        }
    };

    /* ============================================================
       1. Illustrations
       ============================================================ */
    function svgData(label, color) {
        var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">' +
            '<rect width="800" height="450" fill="' + color + '"/>' +
            '<text x="400" y="238" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" ' +
            'font-size="34" letter-spacing="10">' + label + '</text></svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    }
    var ILLUSTRATIONS = {
        world: svgData('WORLD', '#1e3a8a'),
        india: svgData('INDIA', '#065f46'),
        telangana: svgData('TELANGANA', '#7c2d12'),
        default: svgData('SANJANAIAS', '#0e1a33')
    };

    /* ============================================================
       2. Seed data
       ============================================================ */
    var SEED_NEWS = {
        updated: null,
        health: { checked: 0, failed: 0 },
        topics: []
    };

    var SEED_SOURCES = {
        sources: [
            { id: 'un-news', name: 'UN News', level: 'primary', region: 'world', feed: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', enabled: true },
            { id: 'un-geneva', name: 'UN Geneva', level: 'primary', region: 'world', feed: 'https://www.ungeneva.org/en/news-media/rss', enabled: true },
            { id: 'who', name: 'WHO', level: 'primary', region: 'world', feed: 'https://www.who.int/rss-feeds/news-english.xml', enabled: true },
            { id: 'world-bank', name: 'World Bank', level: 'primary', region: 'world', feed: 'https://www.worldbank.org/en/news/rss', enabled: true },
            { id: 'imf', name: 'IMF', level: 'primary', region: 'world', feed: 'https://www.imf.org/en/News/RSS', enabled: true },
            { id: 'pib', name: 'PIB', level: 'primary', region: 'india', feed: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', enabled: true },
            { id: 'rbi', name: 'RBI', level: 'primary', region: 'india', feed: 'https://rbi.org.in/pressreleases_rss.xml', enabled: true },
            { id: 'bbc-world', name: 'BBC News — World', level: 'reporting', region: 'world', feed: 'https://feeds.bbci.co.uk/news/world/rss.xml', enabled: true },
            { id: 'guardian-world', name: 'The Guardian — World', level: 'reporting', region: 'world', feed: 'https://www.theguardian.com/world/rss', enabled: true },
            { id: 'ie-world', name: 'Indian Express — World', level: 'reporting', region: 'world', feed: 'https://indianexpress.com/section/world/feed/', enabled: true },
            { id: 'ie-india', name: 'Indian Express — India', level: 'reporting', region: 'india', feed: 'https://indianexpress.com/section/india/feed/', enabled: true },
            { id: 'ie-hyderabad', name: 'Indian Express — Hyderabad', level: 'reporting', region: 'telangana', feed: 'https://indianexpress.com/section/cities/hyderabad/feed/', enabled: true },
            { id: 'hindu-national', name: 'The Hindu — National', level: 'reporting', region: 'india', feed: 'https://www.thehindu.com/news/national/feeder/default.rss', enabled: true },
            { id: 'hindu-international', name: 'The Hindu — International', level: 'reporting', region: 'world', feed: 'https://www.thehindu.com/news/international/feeder/default.rss', enabled: true }
        ]
    };

    var SEED_SYLLABUS = {
        papers: [
            {
                code: 'GS I', name: 'Heritage, History, Geography and Society', areas: [
                    'Indian culture — art forms, literature and architecture',
                    'Modern Indian history and the freedom struggle',
                    'Post-independence consolidation and reorganisation',
                    'World history and major social/economic developments',
                    'Indian society — diversity, social empowerment, communalism, regionalism, secularism',
                    'Physical geography of the world and India',
                    'Distribution of key natural resources',
                    'Urbanisation, poverty and developmental issues',
                    'Effects of globalisation on Indian society'
                ]
            },
            {
                code: 'GS II', name: 'Governance, Constitution, Polity, Social Justice, IR', areas: [
                    'Indian Constitution — historical underpinnings, features, amendments, basic structure',
                    'Fundamental rights, directive principles and fundamental duties',
                    'Federal structure and devolution of powers',
                    'Separation of powers and dispute redressal mechanisms',
                    'Parliament, state legislatures, executive and judiciary',
                    'Government policies, interventions and welfare schemes',
                    'Statutory, regulatory and quasi-judicial bodies',
                    'Governance, transparency and accountability',
                    'Poverty, health, education and vulnerable sections',
                    'India and its neighbourhood relations',
                    'Bilateral, regional and global groupings and agreements',
                    'Important international institutions, agencies and fora'
                ]
            },
            {
                code: 'GS III', name: 'Technology, Economic Development, Environment, Security', areas: [
                    'Indian economy — growth, development and employment',
                    'Inclusive growth and issues arising from it',
                    'Government budgeting and fiscal policy',
                    'Banking, monetary policy and financial markets',
                    'Agriculture, MSP, irrigation and food processing',
                    'Infrastructure — energy, ports, roads, airports, railways',
                    'Investment models and industrial policy',
                    'Science and technology — developments and applications',
                    'Conservation, environmental pollution and degradation',
                    'Climate change and disaster management',
                    'Internal security, cyber security and border management',
                    'Role of external state and non-state actors in security'
                ]
            },
            {
                code: 'GS IV', name: 'Ethics, Integrity and Aptitude', areas: [
                    'Ethics and human interface — essence, determinants and consequences',
                    'Attitude, aptitude and foundational values for civil service',
                    'Emotional intelligence and its application',
                    'Contributions of moral thinkers and philosophers',
                    'Public and private administration — ethics and accountability',
                    'Probity in governance and corruption',
                    'Case studies on ethical dilemmas in public administration'
                ]
            },
            {
                code: 'Prelims', name: 'Objective Examination — GS Paper I and CSAT Paper II', areas: [
                    'Current events of national and international importance',
                    'Indian history, art and culture',
                    'Indian and world geography',
                    'Indian polity and governance',
                    'Economic and social development',
                    'Environmental ecology, biodiversity and climate change',
                    'General science',
                    'CSAT — comprehension, logical reasoning and basic numeracy'
                ]
            }
        ]
    };

    var SEED_QUESTIONS = {
        prelims: [
            {
                id: 'p1', topicId: 'world-climate-finance-goal', paper: 'GS III',
                question: 'With reference to the Green Climate Fund, consider the following statements: 1) It was established under the Kyoto Protocol. 2) Its headquarters is in Songdo, South Korea. 3) It funds both mitigation and adaptation projects. Which is/are correct?',
                options: ['1 and 2 only', '2 and 3 only', '1 and 3 only', '1, 2 and 3'], answer: 1,
                explanation: 'The Green Climate Fund was established under the UNFCCC, not the Kyoto Protocol — the Adaptation Fund belongs to the Kyoto Protocol. GCF is headquartered in Songdo and funds both mitigation and adaptation.'
            },
            {
                id: 'p2', topicId: 'world-unsc-reform', paper: 'GS II',
                question: 'The \'veto\' in the UN Security Council is best described as:',
                options: ['A power expressly granted by Article 27(3) to negative any resolution', 'The requirement of a concurring vote of all permanent members on non-procedural matters', 'A rule that requires unanimity among all fifteen members', 'A power exercisable only on matters of admission of new members'], answer: 1,
                explanation: 'The word \'veto\' does not appear in the Charter. It is a consequence of the Article 27(3) requirement that decisions on non-procedural matters carry the concurring votes of all permanent members.'
            },
            {
                id: 'p3', topicId: 'world-ai-governance-framework', paper: 'GS III',
                question: 'Which of the following best explains the term \'frontier model\' in AI governance discussions?',
                options: ['Any model trained on national language corpora', 'A model whose scale and generality create significant dual-use risk', 'A model restricted to public-sector use', 'A model that has passed a statutory safety audit'], answer: 1,
                explanation: 'Frontier models are distinguished mainly by scale of compute and generality of capability, which is why regulation tends to trigger above a compute threshold.'
            },
            {
                id: 'p4', topicId: 'india-rbi-mpc-stance', paper: 'GS III',
                question: 'Consider the following about the Monetary Policy Committee: 1) It has six members. 2) The Governor has a casting vote in case of a tie. 3) It was constituted under the RBI Act, 1934 as amended. Which is/are correct?',
                options: ['1 and 2 only', '2 and 3 only', '1 and 3 only', '1, 2 and 3'], answer: 3,
                explanation: 'All three are correct. The MPC has six members (three from RBI, three appointed by the Central Government), the Governor casts the deciding vote, and the framework was created by amending the RBI Act, 1934.'
            },
            {
                id: 'p5', topicId: 'india-green-hydrogen-progress', paper: 'GS III',
                question: 'Green hydrogen is produced primarily by:',
                options: ['Steam methane reforming without carbon capture', 'Electrolysis of water using renewable electricity', 'Coal gasification with carbon capture', 'Partial oxidation of heavy petroleum residues'], answer: 1,
                explanation: 'Green hydrogen uses electrolysis powered by renewable electricity. Steam methane reforming produces grey hydrogen; adding carbon capture yields blue hydrogen.'
            },
            {
                id: 'p6', topicId: 'india-right-to-shelter', paper: 'GS II',
                question: 'The right to shelter in India is best understood as:',
                options: ['An express fundamental right under Article 19', 'A right read into Article 21 as part of the right to life with dignity', 'A fundamental duty under Article 51A', 'A statutory right created by the Municipalities Act'], answer: 1,
                explanation: 'It is a judicially recognised component of Article 21 — the right to life and personal liberty read to include dignity, and through it, adequate shelter. It is not expressly enumerated.'
            },
            {
                id: 'p7', topicId: 'telangana-kaleshwaram-water', paper: 'GS II',
                question: 'With reference to inter-state river water disputes in India: 1) Water is a state subject. 2) Inter-state rivers fall under Entry 56 of the Union List. 3) Tribunals are constituted under the Inter-State River Water Disputes Act, 1956. Which is/are correct?',
                options: ['1 and 2 only', '2 and 3 only', '1 and 3 only', '1, 2 and 3'], answer: 3,
                explanation: 'All three are correct. Entry 17 of the State List covers water, Entry 56 of the Union List covers regulation of inter-state rivers, and tribunals are set up under the 1956 Act.'
            },
            {
                id: 'p8', topicId: 'telangana-ai-city-ecosystem', paper: 'GS III',
                question: 'Data centres are best described as which kind of infrastructure in resource terms?',
                options: ['Low-power, water-neutral facilities', 'High-power facilities with significant cooling water demand', 'Facilities that consume no grid electricity', 'Facilities that require no land beyond the building footprint'], answer: 1,
                explanation: 'Data centres are power-intensive, and a large share of that power and water goes into cooling — which is why siting debates focus on grid and groundwater capacity.'
            },
            {
                id: 'p9', topicId: 'telangana-caste-survey-policy', paper: 'GS II',
                question: 'Which of the following is correct about caste enumeration in India\'s decennial census?',
                options: ['Caste-wise data has been published in every census since 1951', 'Caste-wise population tables have not been published since 1931', 'Caste enumeration is prohibited by the Constitution', 'Only Scheduled Castes and Scheduled Tribes are ever counted'], answer: 1,
                explanation: 'Caste-wise population tables have not been published since the 1931 census, apart from SC/ST counts. This is why state-level caste surveys became the main route to quantified deprivation data.'
            },
            {
                id: 'p10', topicId: 'world-climate-finance-goal', paper: 'GS III',
                question: 'The principle of \'common but differentiated responsibilities\' is associated with:',
                options: ['The Kyoto Protocol only', 'The UNFCCC and subsequent climate agreements', 'The Montreal Protocol', 'The Basel Convention'], answer: 1,
                explanation: 'CBDR is a founding principle of the UNFCCC (1992) and is carried into subsequent agreements, shaping how obligations are distributed between developed and developing countries.'
            },
            {
                id: 'p11', topicId: 'world-unsc-reform', paper: 'GS II',
                question: 'The Ezulwini Consensus is associated with:',
                options: ['The African common position on UN Security Council reform', 'A climate finance mechanism for small island states', 'A trade facilitation agreement at the WTO', 'A nuclear non-proliferation framework'], answer: 0,
                explanation: 'The Ezulwini Consensus sets out Africa\'s common position on UN reform, including two permanent seats with veto power for the continent.'
            },
            {
                id: 'p12', topicId: 'india-rbi-mpc-stance', paper: 'GS III',
                question: 'The Consumer Price Index used as the nominal anchor for India\'s inflation target is compiled by:',
                options: ['The Reserve Bank of India', 'The National Statistical Office under MoSPI', 'NITI Aayog', 'The Ministry of Finance'], answer: 1,
                explanation: 'CPI is compiled by the National Statistical Office, which functions under the Ministry of Statistics and Programme Implementation. The RBI targets it but does not compile it.'
            }
        ],
        mains: [
            {
                id: 'm1', topicId: 'world-climate-finance-goal', paper: 'GS III', marks: 15,
                question: 'Discuss the significance of climate finance for developing countries. How far does the shift from headline pledges to measurable, accessible flows address their concerns?',
                checklist: ['Defined climate finance and its sources', 'Explained the adaptation vs mitigation imbalance', 'Discussed grant vs loan distinction', 'Referenced a specific institution or fund', 'Concluded with an actionable reform suggestion'],
                approach: {
                    intro: 'Define climate finance as flows that support mitigation and adaptation, and locate it within the UNFCCC\'s equity architecture.',
                    body: ['Scale and predictability: why headline pledges underperform the actual need', 'Quality of finance: grants versus loans and the debt-stress risk for vulnerable economies', 'Adaptation deficit: why mitigation-heavy portfolios leave the most exposed states underfunded', 'Access barriers: accreditation procedures, co-financing requirements and direct access'],
                    conclusion: 'Link finance quality to the credibility of the multilateral climate regime, and recommend a defined grant floor with common reporting standards.'
                }
            },
            {
                id: 'm2', topicId: 'world-unsc-reform', paper: 'GS II', marks: 15,
                question: '“The demand for UN Security Council reform is a demand for legitimacy, not merely representation.” Critically examine.',
                checklist: ['Explained the Council\'s composition', 'Discussed the Charter amendment procedure', 'Cited the G4 and Ezulwini positions', 'Addressed the veto question', 'Balanced representation with effectiveness'],
                approach: {
                    intro: 'Frame the Council\'s 1945 composition against present-day power distribution.',
                    body: ['Representation argument: regions and populations currently unrepresented in permanent membership', 'Legitimacy argument: decisions that bind all members without consent of most of them', 'Institutional constraint: Article 108 amendment procedure and P5 ratification', 'Competing regional claims that complicate a single expansion formula', 'Effectiveness question: would expansion make the Council slower?'],
                    conclusion: 'Argue for text-based negotiation and an intermediate model, and link reform to the UN\'s wider credibility.'
                }
            },
            {
                id: 'm3', topicId: 'world-ai-governance-framework', paper: 'GS III', marks: 15,
                question: 'Examine the case for binding regulation of frontier AI models. What safeguards are needed to ensure that such regulation does not entrench existing technological advantage?',
                checklist: ['Defined frontier models', 'Discussed dual-use risk', 'Addressed regulatory divergence', 'Raised the Global South equity concern', 'Proposed a specific safeguard'],
                approach: {
                    intro: 'Define frontier models by scale and generality, and note the shift from voluntary commitments to statutory duties.',
                    body: ['Risk case: biosecurity, cyber offence and information integrity', 'Why voluntarism failed: incomparable evaluations and no enforcement', 'Compliance cost as a barrier to entry for smaller developers', 'Compute concentration and its geopolitical consequences', 'Safeguards: tiered obligations, public compute, harmonised standards, mutual recognition'],
                    conclusion: 'Regulation should be risk-proportionate and internationally interoperable so that safety does not become a euphemism for market closure.'
                }
            },
            {
                id: 'm4', topicId: 'india-rbi-mpc-stance', paper: 'GS III', marks: 15,
                question: '“Monetary policy is a blunt instrument against supply-side inflation.” Discuss in the context of India\'s inflation-targeting framework.',
                checklist: ['Explained the inflation-targeting framework', 'Distinguished demand-pull from cost-push inflation', 'Discussed transmission', 'Mentioned food inflation', 'Suggested supply-side complements'],
                approach: {
                    intro: 'Set out the statutory framework: CPI anchor, target band and the MPC\'s mandate.',
                    body: ['Why interest rates act on demand rather than supply', 'Food and fuel shocks as persistent sources of headline volatility', 'Transmission gaps through bank lending and non-bank channels', 'Coordination with fiscal policy and supply-side management', 'Communication as a policy tool'],
                    conclusion: 'Monetary policy remains necessary for anchoring expectations, but it must be complemented by supply-side reform.'
                }
            },
            {
                id: 'm5', topicId: 'india-green-hydrogen-progress', paper: 'GS III', marks: 15,
                question: 'Evaluate the National Green Hydrogen Mission\'s progress. Why does off-take certainty matter as much as production capacity?',
                checklist: ['Described the mission\'s two tracks', 'Discussed levelised cost', 'Addressed off-take and demand aggregation', 'Mentioned water and land constraints', 'Linked to NDCs and industrial decarbonisation'],
                approach: {
                    intro: 'Summarise the mission\'s objective and its two-track incentive design.',
                    body: ['Cost drivers: renewable power price and electrolyser utilisation', 'The missing demand side: why capacity without contracts idles', 'Hard-to-abate sectors as anchor buyers', 'Water and land as siting constraints', 'Export market opportunities and carbon-intensity pricing'],
                    conclusion: 'Recommend blending mandates with sunset clauses and cluster-based demand aggregation.'
                }
            },
            {
                id: 'm6', topicId: 'india-right-to-shelter', paper: 'GS II', marks: 15,
                question: 'Trace the judicial recognition of the right to shelter in India. What institutional gaps prevent its realisation at the municipal level?',
                checklist: ['Cited Article 21', 'Traced the dignity–shelter link', 'Identified municipal capacity gaps', 'Discussed eviction practices', 'Proposed a concrete institutional fix'],
                approach: {
                    intro: 'Locate the right to shelter within the expansive interpretation of Article 21.',
                    body: ['Evolution from livelihood to dignity to shelter', 'The gap between judicial recognition and statutory duty', 'Municipal finance and planning capacity', 'Data gaps on hidden homelessness', 'Eviction practice and the absence of mandatory prior assessment'],
                    conclusion: 'Recommend statutory shelter-capacity audits and timelines before displacement.'
                }
            },
            {
                id: 'm7', topicId: 'telangana-kaleshwaram-water', paper: 'GS II', marks: 15,
                question: 'Large lift irrigation projects solve a geographic problem but create a fiscal and ecological one. Examine with reference to the Godavari basin.',
                checklist: ['Explained the geographic rationale for lift irrigation', 'Discussed energy cost', 'Addressed inter-state allocation', 'Raised ecological concerns', 'Proposed a basin-level planning approach'],
                approach: {
                    intro: 'Explain why upland command areas require lifting, and what that implies physically.',
                    body: ['Energy intensity of multi-stage pumping', 'Fiscal implications for state budgets', 'Inter-state allocation framework under the 1956 Act', 'Ecological flows and river health', 'Groundwater recharge and conjunctive use as complements'],
                    conclusion: 'Argue for transparent flow accounting and basin-level planning over project-by-project optimisation.'
                }
            },
            {
                id: 'm8', topicId: 'telangana-ai-city-ecosystem', paper: 'GS III', marks: 15,
                question: '“Competing for data-centre investment is not the same as building an AI economy.” Discuss with reference to Hyderabad\'s technology ecosystem.',
                checklist: ['Distinguished infrastructure from capability', 'Discussed skilling', 'Mentioned resource constraints', 'Raised the risk of low-value work', 'Proposed a policy alternative'],
                approach: {
                    intro: 'Describe Hyderabad\'s transition from IT services towards AI and data infrastructure.',
                    body: ['Data centres as capital-intensive but low-employment infrastructure', 'The skills mismatch in applied AI', 'Power and water constraints', 'Risk of incentive competition producing stranded assets', 'Alternative: research funding, curriculum reform and green infrastructure standards'],
                    conclusion: 'Shift from subsidy competition to capability building, with measurable skilling outcomes.'
                }
            },
            {
                id: 'm9', topicId: 'telangana-caste-survey-policy', paper: 'GS II', marks: 15,
                question: 'State-level caste surveys raise both governance and constitutional questions. Discuss.',
                checklist: ['Explained the data gap since 1931', 'Distinguished welfare targeting from reservation', 'Discussed the 50 per cent ceiling', 'Addressed methodology and data quality', 'Proposed a legal and administrative way forward'],
                approach: {
                    intro: 'Locate the survey in the long gap in published caste-wise census data.',
                    body: ['Welfare targeting: Article 15(4) and 16(4) as enabling provisions', 'Reservation: the Indra Sawhney ceiling and later exceptions', 'Methodology risks: self-reporting, enumerator bias, category contestation', 'Federal dimension: states acting where the census does not', 'Transparency and independent validation as trust-building measures'],
                    conclusion: 'Argue that data quality and legal clarity together determine whether quantified social justice is achievable.'
                }
            }
        ]
    };

    /* ============================================================
       3. Utilities
       ============================================================ */
    function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
    function $$(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function stripHtml(s) {
        if (!s) return '';
        return String(s)
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .trim();
    }
    // Fix Timezone: Get local YYYY-MM-DD
    function getTodayLocal() {
        return new Date().toLocaleDateString('en-CA');
    }
    function getWeekAgoLocal() {
        return new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA');
    }
    function fmtDate(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    }
    function fmtRelative(iso) {
        var d = new Date(iso); if (isNaN(d)) return '';
        var diff = (Date.now() - d.getTime()) / 3600000;
        if (diff < 1) return 'just now';
        if (diff < 24) return Math.round(diff) + 'h ago';
        if (diff < 168) return Math.round(diff / 24) + 'd ago';
        return fmtDate(iso);
    }
    function truncate(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
    }
    function shuffle(a) {
        var arr = a.slice();
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }
    function toast(msg) {
        var el = $('.toast');
        if (!el) {
            el = document.createElement('div');
            el.className = 'toast';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        el.textContent = msg;
        requestAnimationFrame(function () { el.classList.add('show'); });
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
    }
    function topicImage(t) {
        return t.image || ILLUSTRATIONS[t.region] || ILLUSTRATIONS.default;
    }

    /* ============================================================
       4. Storage
       ============================================================ */
    var PREFIX = 'sanjana.';
    function storeGet(key, fallback) {
        try { var raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) : fallback; }
        catch (e) { return fallback; }
    }
    function storeSet(key, value) {
        try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { }
    }
    var _mem = {
        bookmarks: [],
        read: {},
        notes: {},
        missed: {},
        mains: {},
        quiz: { attempts: [], best: 0 },
        days: []
    };

    function _getGuestCount(key) {
        try { return parseInt(localStorage.getItem('sanjana.guest_' + key) || '0', 10); } catch (e) { return 0; }
    }
    function _incGuestCount(key) {
        try { localStorage.setItem('sanjana.guest_' + key, _getGuestCount(key) + 1); } catch (e) { }
    }
    function _requireLogin(action) {
        if (SI_AUTH.user) return true;
        if (typeof window._openAuthModal === 'function') {
            window._openAuthModal('Please log in to ' + (action || 'continue') + '.');
        }
        return false;
    }

    function _cloud(table) { return supabaseClient ? supabaseClient.from(table) : null; }

    function _safeWrite(promise) {
        if (!promise) return;
        promise.then(function (r) {
            if (r && r.error) {
                toast('Save failed. Please check your connection.');
                console.error('DB Write Error:', r.error);
            }
        }).catch(function (e) {
            toast('Network error. Changes not saved.');
            console.error('DB Network Error:', e);
        });
    }

    async function _loadUserData() {
        if (!SI_AUTH.user || !supabaseClient) {
            _mem = { bookmarks: [], read: {}, notes: {}, missed: {}, mains: {}, quiz: { attempts: [], best: 0 }, days: [] };
            return;
        }
        var uid = SI_AUTH.user.id;
        try {
            var [bm, notes, mains, rev, prog] = await Promise.all([
                supabaseClient.from('bookmarks').select('topic_slug').eq('user_id', uid),
                supabaseClient.from('notes').select('topic_slug,text,updated_at').eq('user_id', uid),
                supabaseClient.from('mains_drafts').select('question_id,text,checklist,updated_at').eq('user_id', uid),
                supabaseClient.from('revision_entries').select('item_id,type,created_at').eq('user_id', uid),
                supabaseClient.from('progress').select('quiz_attempts,active_days').eq('user_id', uid).maybeSingle()
            ]);
            _mem.bookmarks = (bm.data || []).map(function (r) { return r.topic_slug; });
            _mem.notes = {};
            (notes.data || []).forEach(function (r) { _mem.notes[r.topic_slug] = { text: r.text, at: new Date(r.updated_at).getTime() }; });
            _mem.mains = {};
            (mains.data || []).forEach(function (r) { _mem.mains[r.question_id] = Object.assign({ text: r.text, at: new Date(r.updated_at).getTime() }, r.checklist || {}); });
            _mem.read = {};
            _mem.missed = {};
            (rev.data || []).forEach(function (r) {
                var ts = new Date(r.created_at).getTime();
                if (r.type === 'read') _mem.read[r.item_id] = ts;
                if (r.type === 'missed') _mem.missed[r.item_id] = ts;
            });
            _mem.quiz = {
                attempts: (prog.data && prog.data.quiz_attempts) || [],
                best: ((prog.data && prog.data.quiz_attempts) || []).reduce(function (b, a) { return Math.max(b, a.score); }, 0)
            };
            _mem.days = (prog.data && prog.data.active_days) || [];
        } catch (e) { console.warn('loadUserData failed', e); }
    }

    var SI_STORE = {
        bookmarks: function () { return _mem.bookmarks.slice(); },
        isBookmarked: function (id) { return _mem.bookmarks.indexOf(id) > -1; },
        toggleBookmark: function (id) {
            if (!_requireLogin('bookmark')) return false;
            var i = _mem.bookmarks.indexOf(id);
            var on;
            if (i > -1) {
                _mem.bookmarks.splice(i, 1); on = false;
                _safeWrite(_cloud('bookmarks').delete().eq('user_id', SI_AUTH.user.id).eq('topic_slug', id));
            } else {
                _mem.bookmarks.push(id); on = true;
                _safeWrite(_cloud('bookmarks').upsert({ user_id: SI_AUTH.user.id, topic_slug: id }));
            }
            return on;
        },
        deleteBookmark: function (id) {
            if (!SI_AUTH.user) return;
            _mem.bookmarks = _mem.bookmarks.filter(function (x) { return x !== id; });
            _safeWrite(_cloud('bookmarks').delete().eq('user_id', SI_AUTH.user.id).eq('topic_slug', id));
        },

        read: function () { return Object.assign({}, _mem.read); },
        markRead: function (id) {
            if (!SI_AUTH.user) return; // Silently skip for guests
            if (_mem.read[id]) return;
            _mem.read[id] = Date.now();
            _safeWrite(_cloud('revision_entries').insert({ user_id: SI_AUTH.user.id, item_id: id, type: 'read' }));
        },

        notes: function () { return Object.assign({}, _mem.notes); },
        saveNote: function (id, text) {
            _mem.notes[id] = { text: text, at: Date.now() };
            storeSet('notes', _mem.notes);
            if (!SI_AUTH.user) return; // Save locally for guests, no prompt
            _safeWrite(_cloud('notes').upsert({ user_id: SI_AUTH.user.id, topic_slug: id, text: text, updated_at: new Date().toISOString() }));
        },
        deleteNote: function (id) {
            if (!SI_AUTH.user) return;
            delete _mem.notes[id];
            _safeWrite(_cloud('notes').delete().eq('user_id', SI_AUTH.user.id).eq('topic_slug', id));
        },

        missed: function () { return Object.assign({}, _mem.missed); },
        addMissed: function (id) {
            if (!_mem.missed[id]) { _mem.missed[id] = Date.now(); storeSet('missed', _mem.missed); }
            if (!SI_AUTH.user) return; // Save locally for guests, don't prompt
            _safeWrite(_cloud('revision_entries').insert({ user_id: SI_AUTH.user.id, item_id: id, type: 'missed' }));
        },
        removeMissed: function (id) {
            if (!SI_AUTH.user) return;
            delete _mem.missed[id];
            _safeWrite(_cloud('revision_entries').delete().eq('user_id', SI_AUTH.user.id).eq('item_id', id).eq('type', 'missed'));
        },

        mains: function () { return Object.assign({}, _mem.mains); },
        saveMains: function (id, patch) {
            if (!_requireLogin('save drafts')) return;
            _mem.mains[id] = Object.assign({}, _mem.mains[id], patch, { at: Date.now() });
            var checklist = {};
            Object.keys(_mem.mains[id]).forEach(function (k) { if (k.indexOf('c') === 0) checklist[k] = _mem.mains[id][k]; });
            _safeWrite(_cloud('mains_drafts').upsert({
                user_id: SI_AUTH.user.id, question_id: id,
                text: _mem.mains[id].text || '', checklist: checklist,
                updated_at: new Date().toISOString()
            }));
        },
        deleteMains: function (id) {
            if (!SI_AUTH.user) return;
            delete _mem.mains[id];
            _safeWrite(_cloud('mains_drafts').delete().eq('user_id', SI_AUTH.user.id).eq('question_id', id));
        },

        quiz: function () { return _mem.quiz; },
        saveQuiz: function (attempt) {
            _mem.quiz.attempts = (_mem.quiz.attempts || []).concat(attempt).slice(-50);
            _mem.quiz.best = Math.max(_mem.quiz.best || 0, attempt.score);
            storeSet('quiz', _mem.quiz);
            if (!SI_AUTH.user) return;
            _safeWrite(_cloud('progress').upsert({ user_id: SI_AUTH.user.id, quiz_attempts: _mem.quiz.attempts, active_days: _mem.days }));
        },

        days: function () { return _mem.days.slice(); },
        touchDay: function () {
            if (!_requireLogin('track progress')) return;
            var today = getTodayLocal();
            if (_mem.days.indexOf(today) === -1) {
                _mem.days.push(today);
                _safeWrite(_cloud('progress').upsert({ user_id: SI_AUTH.user.id, quiz_attempts: _mem.quiz.attempts, active_days: _mem.days }));
            }
        },

        cleanup: function () { return { bookmarks: _mem.bookmarks.length }; },

        reset: async function () {
            _mem = { bookmarks: [], read: {}, notes: {}, missed: {}, mains: {}, quiz: { attempts: [], best: 0 }, days: [] };
            if (!SI_AUTH.user) return; // Guest just cleared memory
            await Promise.all([
                _cloud('bookmarks').delete().eq('user_id', SI_AUTH.user.id),
                _cloud('notes').delete().eq('user_id', SI_AUTH.user.id),
                _cloud('mains_drafts').delete().eq('user_id', SI_AUTH.user.id),
                _cloud('revision_entries').delete().eq('user_id', SI_AUTH.user.id),
                _cloud('progress').delete().eq('user_id', SI_AUTH.user.id)
            ]);
            _mem = { bookmarks: [], read: {}, notes: {}, missed: {}, mains: {}, quiz: { attempts: [], best: 0 }, days: [] };
        }
    };

    /* ============================================================
       5. RSS / Classifier / Dedupe / Relevance (also Node-usable)
       ============================================================ */
    var SI_RSS = (function () {
        function decode(s) {
            return String(s || '')
                .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>') // Unescape first
                .replace(/<[^>]+>/g, ' ') // Then strip tags
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
                .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
                .replace(/\s+/g, ' ').trim();
        }
        function firstDate(str) {
            var d = new Date(str);
            return isNaN(d) ? null : d.toISOString();
        }
        function parseWithDOM(xmlText) {
            if (typeof DOMParser === 'undefined') return [];
            var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            if (doc.querySelector('parsererror')) return [];
            var nodes = Array.prototype.slice.call(doc.querySelectorAll('item, entry'));
            return nodes.map(function (node) {
                function pick(sel) { var el = node.querySelector(sel); return el ? (el.textContent || '').trim() : ''; }
                var linkEl = node.querySelector('link');
                var link = (linkEl && (linkEl.getAttribute('href') || linkEl.textContent)) || pick('guid');
                return {
                    title: decode(pick('title')),
                    link: (link || '').trim(),
                    description: decode(pick('description') || pick('summary') || pick('content')),
                    published: firstDate(pick('pubDate') || pick('published') || pick('updated')),
                    image: (node.querySelector('enclosure') && node.querySelector('enclosure').getAttribute('url')) ||
                        (node.querySelector('media\\:content') && node.querySelector('media\\:content').getAttribute('url')) || ''
                };
            }).filter(function (i) { return i.title && i.link; });
        }
        function parseWithRegex(xmlText) {
            var blocks = xmlText.match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
            return blocks.map(function (block) {
                function tag(name) {
                    var m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
                    return m ? m[1] : '';
                }
                function attr(name, a) {
                    var m = block.match(new RegExp('<' + name + '[^>]*' + a + '="([^"]+)"', 'i'));
                    return m ? m[1] : '';
                }
                var link = attr('link', 'href') || decode(tag('link')) || decode(tag('guid'));
                return {
                    title: decode(tag('title')),
                    link: link,
                    description: decode(tag('description') || tag('summary') || tag('content')),
                    published: firstDate(decode(tag('pubDate') || tag('published') || tag('updated'))),
                    image: attr('media:content', 'url') || attr('enclosure', 'url') || ''
                };
            }).filter(function (i) { return i.title && i.link; });
        }
        return {
            decode: decode,
            parse: function (xmlText) {
                var out = parseWithDOM(xmlText);
                return out.length ? out : parseWithRegex(xmlText);
            }
        };
    })();

    var SI_CLASSIFY = (function () {
        var RULES = [
            { paper: 'GS I', category: 'Geography', words: ['river', 'monsoon', 'glacier', 'earthquake', 'cyclone', 'delta', 'plateau', 'forest cover', 'urbanisation', 'migration', 'tribe', 'heritage', 'culture', 'festival'] },
            { paper: 'GS I', category: 'History', words: ['ancient', 'medieval', 'colonial', 'freedom movement', 'inscription', 'excavation', 'archaeolog'] },
            { paper: 'GS II', category: 'Polity', words: ['parliament', 'bill', 'constitution', 'amendment', 'supreme court', 'high court', 'judgment', 'governor', 'election commission', 'panchayat', 'fundamental right', 'article 21'] },
            { paper: 'GS II', category: 'Governance', words: ['scheme', 'policy', 'ministry', 'cabinet', 'governance', 'welfare', 'subsidy', 'mission', 'committee report', 'cag'] },
            { paper: 'GS II', category: 'International Relations', words: ['bilateral', 'treaty', 'summit', 'united nations', 'unsc', 'g20', 'brics', 'wto', 'imf', 'world bank', 'who', 'diplomatic', 'foreign minister', 'sanctions', 'border talks'] },
            { paper: 'GS III', category: 'Economy', words: ['rbi', 'inflation', 'repo rate', 'gdp', 'fiscal', 'budget', 'tax', 'gst', 'banking', 'npa', 'msme', 'trade deficit', 'fdi', 'capital market'] },
            { paper: 'GS III', category: 'Environment', words: ['climate', 'cop', 'emission', 'biodiversity', 'pollution', 'wildlife', 'tiger', 'wetland', 'unfccc', 'green hydrogen', 'solar', 'renewable', 'conservation'] },
            { paper: 'GS III', category: 'Science & Technology', words: ['isro', 'drdo', 'satellite', 'launch vehicle', 'artificial intelligence', 'semiconductor', 'biotech', 'genome', 'quantum', 'nuclear'] },
            { paper: 'GS III', category: 'Security', words: ['defence', 'army', 'navy', 'air force', 'terror', 'cyber security', 'border', 'insurgency', 'drone', 'missile'] },
            { paper: 'GS III', category: 'Agriculture', words: ['farmer', 'crop', 'irrigation', 'msp', 'fertiliser', 'kharif', 'rabi', 'agriculture'] },
            { paper: 'GS IV', category: 'Ethics', words: ['ethics', 'integrity', 'probity', 'conflict of interest', 'corruption', 'accountability'] }
        ];
        var TELANGANA = ['telangana', 'hyderabad', 'warangal', 'karimnagar', 'nizamabad', 'khammam', 'nalgonda',
            'medak', 'adilabad', 'mahbubnagar', 'rangareddy', 'siddipet', 'kaleshwaram', 'godavari', 'musi',
            'charminar', 'secunderabad', 'telugu', 'golconda', 'nagarjuna sagar', 'srisailam'];
        var INDIA = ['india', 'indian', 'parliament', 'lok sabha', 'rajya sabha', 'supreme court of india',
            'rbi', 'pib', 'isro', 'upsc', 'delhi', 'mumbai', 'kolkata', 'chennai', 'bengaluru', 'union government',
            'niti aayog', 'election commission of india'];
        function hits(text, words) {
            var t = text.toLowerCase();
            return words.filter(function (w) { return t.indexOf(w) > -1; });
        }
        return {
            RULES: RULES,
            classify: function (input) {
                var text = [input.title, input.description, input.summary].filter(Boolean).join(' ');
                var tel = hits(text, TELANGANA);
                var ind = hits(text, INDIA);
                var region = 'world';
                if (tel.length >= 2 && tel.length >= ind.length) region = 'telangana';
                else if (ind.length >= 2) region = 'india';
                var regions = [region];
                if (region !== 'world' && hits(text, ['united nations', 'unsc', 'g20', 'wto', 'imf', 'world bank', 'bilateral', 'treaty']).length) {
                    regions.push('world');
                }
                var matched = [];
                var papers = {};
                var category = 'General Studies';
                RULES.forEach(function (rule) {
                    var found = hits(text, rule.words);
                    if (found.length) {
                        papers[rule.paper] = true;
                        matched.push({ category: rule.category, keywords: found });
                        if (category === 'General Studies') category = rule.category;
                    }
                });
                return {
                    region: region,
                    regions: regions,
                    category: category,
                    gsPapers: Object.keys(papers),
                    tags: matched.slice(0, 4).map(function (m) { return m.category; }),
                    matched: matched
                };
            }
        };
    })();

    var SI_DEDUPE = (function () {
        var STOP = {};
        'a an the and or of for to in on at by with from as is are was were be been this that these those it its will would says said new after before over under into about india indian govt government today update latest news report'.split(' ').forEach(function (w) { STOP[w] = true; });
        function normalizeTitle(title) {
            return String(title || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        }
        function tokens(title) {
            return normalizeTitle(title).split(' ').filter(function (w) { return w.length > 2 && !STOP[w]; });
        }
        function jaccard(a, b) {
            var A = new Set(a), B = new Set(b);
            if (!A.size || !B.size) return 0;
            var inter = 0;
            A.forEach(function (x) { if (B.has(x)) inter++; });
            return inter / (A.size + B.size - inter);
        }
        function canonicalUrl(url) {
            try {
                var u = new URL(url);
                ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid'].forEach(function (p) { u.searchParams.delete(p); });
                return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').toLowerCase();
            } catch (e) { return String(url || '').toLowerCase(); }
        }
        function similarity(a, b) {
            var ta = tokens(a.title), tb = tokens(b.title);
            var titleScore = jaccard(ta, tb);
            var descScore = jaccard(tokens(a.description || ''), tokens(b.description || ''));
            var sameDay = a.published && b.published && String(a.published).slice(0, 10) === String(b.published).slice(0, 10);
            return (titleScore * 0.7) + (descScore * 0.3) + (sameDay ? 0.05 : 0);
        }
        function isDuplicate(a, b, threshold) {
            var t = typeof threshold === 'number' ? threshold : 0.55;
            if (!a || !b) return false;
            if (a.link && b.link && canonicalUrl(a.link) === canonicalUrl(b.link)) return true;
            if (normalizeTitle(a.title) === normalizeTitle(b.title)) return true;
            return similarity(a, b) >= t;
        }
        function group(items, threshold) {
            var groups = [];
            items.forEach(function (item) {
                var found = groups.filter(function (g) { return isDuplicate(g.lead, item, threshold); })[0];
                if (found) found.items.push(item);
                else groups.push({ lead: item, items: [item] });
            });
            return groups;
        }
        return { normalizeTitle: normalizeTitle, tokens: tokens, jaccard: jaccard, similarity: similarity, isDuplicate: isDuplicate, group: group, canonicalUrl: canonicalUrl };
    })();

    var SI_RELEVANCE = (function () {
        var WEIGHTS = { syllabusMatch: 30, nationalSignificance: 15, indiaImpact: 15, constitutionalLegal: 12, economicConsequence: 10, environmentSocial: 10, longTerm: 8, examRecurrence: 10 };
        var SIGNALS = {
            constitutionalLegal: ['supreme court', 'high court', 'judgment', 'article', 'amendment', 'act ', 'bill', 'constitution', 'tribunal'],
            economicConsequence: ['rbi', 'inflation', 'gdp', 'budget', 'fiscal', 'trade', 'gst', 'investment', 'employment', 'tariff'],
            environmentSocial: ['climate', 'emission', 'biodiversity', 'pollution', 'health', 'education', 'welfare', 'poverty', 'women', 'caste'],
            longTerm: ['policy', 'mission', 'framework', 'reform', 'strategy', 'agreement', 'treaty', 'target 20'],
            examRecurrence: ['international relations', 'polity', 'economy', 'environment', 'science and technology', 'security'],
            nationalSignificance: ['parliament', 'president', 'prime minister', 'cabinet', 'election commission', 'niti aayog', 'union budget'],
            indiaImpact: ['india', 'indian', 'new delhi', 'rupee', 'domestic']
        };
        var EXCLUDE = ['celebrity', 'box office', 'film review', 'cricket score', 'entertainment', 'horoscope', 'viral video'];
        function has(text, words) { return words.some(function (w) { return text.indexOf(w) > -1; }); }
        return {
            score: function (topic) {
                var text = [topic.title, topic.summary, topic.description, (topic.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
                if (has(text, EXCLUDE)) return { score: 5, reasons: ['Matches an excluded category.'], excluded: true };
                var reasons = [], total = 0;
                if ((topic.gsPapers || []).length) { total += WEIGHTS.syllabusMatch; reasons.push('Maps to ' + topic.gsPapers.join(', ') + '.'); }
                Object.keys(SIGNALS).forEach(function (key) {
                    if (has(text, SIGNALS[key])) { total += WEIGHTS[key]; reasons.push('Signals ' + key.replace(/([A-Z])/g, ' $1').toLowerCase() + '.'); }
                });
                var value = Math.max(5, Math.min(100, Math.round(total * 100 / 110)));
                if (!reasons.length) reasons.push('Generic coverage with no clear syllabus anchor.');
                return { score: value, reasons: reasons, excluded: false };
            },
            WEIGHTS: WEIGHTS, EXCLUDE: EXCLUDE
        };
    })();

    /* ============================================================
       6. State + Search
       ============================================================ */
    var State = {
        news: { updated: null, topics: SEED_NEWS.topics.slice() },
        sources: SEED_SOURCES.sources.slice(),
        syllabus: SEED_SYLLABUS.papers.slice(),
        questions: SEED_QUESTIONS
    };

    function allTopics() { return State.news.topics.slice(); }
    function getTopic(id) {
        return State.news.topics.filter(function (t) { return t.id === id; })[0];
    }
    function byImportance(list) { return list.slice().sort(function (a, b) { return (b.importance || 0) - (a.importance || 0); }); }
    function byDate(list) { return list.slice().sort(function (a, b) { return new Date(b.published || 0) - new Date(a.published || 0); }); }
    function regionLabel(r) { return { world: 'World', india: 'India', telangana: 'Telangana' }[r] || r; }

    function blobOf(t) {
        if (!t._blob) {
            var s = t.sections || {};
            t._blob = [t.title, t.summary, t.whyItMatters, t.category, (t.tags || []).join(' '),
            (t.gsPapers || []).join(' '), t.region,
            s.event, s.background, s.india, s.telangana, s.upsc,
            (s.prelimsNotes || []).join(' '), (s.mainsNotes || []).join(' ')]
                .filter(Boolean).join(' ').toLowerCase();
        }
        return t._blob;
    }
    var SI_SEARCH = {
        query: function (q, opts) {
            opts = opts || {};
            var words = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
            if (!words.length) return [];
            return allTopics()
                .filter(function (t) {
                    return !opts.region || t.region === opts.region || (Array.isArray(t.regions) && t.regions.indexOf(opts.region) > -1);
                })
                .map(function (t) {
                    var title = String(t.title || '').toLowerCase();
                    var summary = String(t.summary || '').toLowerCase();
                    var body = blobOf(t);
                    var score = 0;
                    words.forEach(function (w) {
                        if (title.indexOf(w) > -1) score += 6;
                        if (summary.indexOf(w) > -1) score += 3;
                        if (body.indexOf(w) > -1) score += 1;
                    });
                    if (t.importance) score += t.importance / 100;
                    return { topic: t, score: score };
                })
                .filter(function (r) { return r.score > 0; })
                .sort(function (a, b) { return b.score - a.score; })
                .slice(0, opts.limit || 20);
        },
        related: function (topic, limit) {
            var tags = new Set((topic.tags || []).concat(topic.gsPapers || []));
            return allTopics()
                .filter(function (t) { return t.id !== topic.id; })
                .map(function (t) {
                    var overlap = (t.tags || []).concat(t.gsPapers || []).filter(function (x) { return tags.has(x); }).length;
                    return { topic: t, overlap: overlap };
                })
                .filter(function (r) { return r.overlap > 0; })
                .sort(function (a, b) { return b.overlap - a.overlap; })
                .slice(0, limit || 3)
                .map(function (r) { return r.topic; });
        }
    };

    /* ============================================================
       7. Renderers
       ============================================================ */
    function chips(t) {
        var gs = (t.gsPapers || []).map(function (p) { return '<span class="chip chip-gs">' + esc(p) + '</span>'; }).join('');
        return gs + '<span class="chip">' + esc(t.category || 'General') + '</span>';
    }
    function card(t) {
        var href = '/article/' + encodeURIComponent(t.id);
        var bm = SI_STORE.isBookmarked(t.id);
        return '<article class="topic-card">' +
            '<a class="card-media" href="' + href + '">' +
            '<img src="' + esc(topicImage(t)) + '" alt="" loading="lazy" onerror="this.onerror=null; this.src=\'' + (ILLUSTRATIONS[t.region] || ILLUSTRATIONS.default) + '\'">' +
            '<span class="region-badge ' + esc(t.region) + '">' + esc(regionLabel(t.region)) + '</span>' +
            '</a>' +
            '<div class="card-body">' +
            '<div class="chips">' + chips(t) + '</div>' +
            '<h3 class="card-title"><a href="' + href + '">' + esc(t.title) + '</a></h3>' +
            '<p class="card-summary">' + esc(truncate(t.summary, 160)) + '</p>' +
            '<div class="card-foot">' +
            '<span>' + fmtDate(t.published) + '</span><span>·</span>' +
            '<span>' + (t.readTime || 5) + ' min read</span>' +
            '<span class="dot"></span>' +
            '<span>' + (t.sources || []).length + ' source' + ((t.sources || []).length === 1 ? '' : 's') + '</span>' +
            '<button class="bm-btn ' + (bm ? 'on' : '') + '" data-bm="' + esc(t.id) + '" type="button" aria-label="Bookmark">' + (bm ? '★' : '☆') + '</button>' +
            '</div>' +
            '</div>' +
            '</article>';
    }
    function listRow(t, i) {
        var href = '/article/' + encodeURIComponent(t.id);
        return '<div class="list-row">' +
            (i == null ? '' : '<span class="rank">' + String(i + 1).padStart(2, '0') + '</span>') +
            '<div class="lr-body">' +
            '<div class="chips">' + chips(t) + '</div>' +
            '<h3><a href="' + href + '">' + esc(t.title) + '</a></h3>' +
            '<p>' + esc(truncate(t.summary, 140)) + '</p>' +
            '</div>' +
            '<span class="lr-meta">' + fmtRelative(t.published) + '</span>' +
            '</div>';
    }

    /* ============================================================
       8. Article renderer
       ============================================================ */
    var ARTICLE_SECTIONS = [
        ['event', 'The event'], ['background', 'Background'], ['causes', 'Causes'],
        ['stakeholders', 'Important stakeholders'], ['timeline', 'Timeline'], ['data', 'Important data'],
        ['geography', 'Geography'], ['india', "India's perspective"], ['telangana', 'Telangana connection'],
        ['challenges', 'Challenges'], ['solutions', 'Possible solutions'], ['upsc', 'UPSC connection'],
        ['prelimsNotes', 'Prelims notes'], ['mainsNotes', 'Mains notes']
    ];
    var SI_ARTICLE = {
        render: function (root, id) {
            var t = getTopic(id);
            if (!t) {
                root.innerHTML = '<div class="panel"><h1>Topic not found</h1>' +
                    '<p class="fine">This research page does not exist in the library.</p>' +
                    '<a class="btn" href="/dashboard">Back to the dashboard</a></div>';
                return;
            }
            SI_STORE.markRead(t.id);
            var bm = SI_STORE.isBookmarked(t.id);
            var note = (SI_STORE.notes()[t.id] || {}).text || '';
            var s = t.sections || {};

            function secHTML(key, label) {
                var val = s[key];
                if (!val) return '';
                if (Array.isArray(val) && !val.length) return '';
                if (typeof val === 'string' && (val.indexOf('has not been written yet') > -1 || val.indexOf('Auto-classified under') > -1)) return '';
                var body = '';
                if (key === 'timeline') {
                    body = '<ul class="timeline">' + val.map(function (e) { return '<li><time>' + esc(e.date) + '</time>' + esc(e.text) + '</li>'; }).join('') + '</ul>';
                } else if (key === 'data') {
                    body = '<dl class="kv">' + val.map(function (d) { return '<dt>' + esc(d.label) + '</dt><dd>' + esc(d.value) + '</dd>'; }).join('') + '</dl>';
                } else if (Array.isArray(val)) {
                    body = '<ul>' + val.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ul>';
                } else {
                    body = '<p>' + esc(val) + '</p>';
                }
                return '<section class="art-sec" id="sec-' + key + '"><h2>' + esc(label) + '</h2>' + body + '</section>';
            }

            function practiceHTML() {
                var p = SEED_QUESTIONS.prelims.filter(function (q) { return q.topicId === t.id; });
                var m = SEED_QUESTIONS.mains.filter(function (q) { return q.topicId === t.id; });
                if (!p.length && !m.length) return '';
                var out = '<section class="art-sec" id="sec-practice"><h2>Practice questions</h2>';
                if (p.length) {
                    out += '<h3>Prelims</h3><ol>' + p.map(function (q) { return '<li>' + esc(q.question) + '</li>'; }).join('') + '</ol>' +
                        '<a class="btn" href="/prelims">Attempt these MCQs</a>';
                }
                if (m.length) {
                    out += '<h3 style="margin-top:16px">Mains</h3><ol>' + m.map(function (q) { return '<li>' + esc(q.question) + ' <span class="fine">(' + q.marks + ' marks)</span></li>'; }).join('') + '</ol>' +
                        '<a class="btn" href="/mains">Write an answer</a>';
                }
                return out + '</section>';
            }

            function sourcesHTML() {
                var list = t.sources || [];
                var out = '<section class="art-sec" id="sec-references"><h2>References</h2>';
                if (list.length) {
                    out += '<ul class="src-list">' + list.map(function (sr) {
                        return '<li><span class="src-type">' + esc(sr.type || 'source') + '</span>' +
                            '<a href="' + esc(sr.url) + '" target="_blank" rel="noopener noreferrer">' + esc(sr.title) + '</a>' +
                            ' <span class="fine">— ' + esc(sr.publisher) + (sr.date ? ', ' + fmtDate(sr.date) : '') + '</span></li>';
                    }).join('') + '</ul>';
                } else {
                    out += '<p class="fine">No sources recorded.</p>';
                }
                out += '<p class="fine">Two outlets repeating the same agency report are not treated as two independent confirmations.</p></section>';
                return out;
            }

            root.innerHTML =
                '<article>' +
                '<header class="article-head">' +
                '<div class="chips"><span class="chip">' + esc(regionLabel(t.region)) + '</span>' + chips(t) + '</div>' +
                '<h1>' + esc(t.title) + '</h1>' +
                '<p class="lede">' + esc(t.summary) + '</p>' +
                '<div class="article-meta">' +
                '<span>Published ' + fmtDate(t.published) + '</span><span>·</span>' +
                '<span>Last updated ' + fmtDate(t.updated || t.published) + '</span><span>·</span>' +
                '<span>' + (t.readTime || 5) + ' min read</span><span>·</span>' +
                '<span>' + (t.sources || []).length + ' references</span>' +
                (t.importance ? '<span>·</span><span>Relevance score ' + t.importance + '/100</span>' : '') +
                '</div>' +
                (t.curated ? '' : '<div class="banner">Auto-collected item. The summary is derived from the publisher description and has not been editorially verified.</div>') +
                '<img class="article-hero" src="' + esc(topicImage(t)) + '" alt="" onerror="this.onerror=null; this.src=\'' + (ILLUSTRATIONS[t.region] || ILLUSTRATIONS.default) + '\'">' +
                '<p class="img-credit">' + esc(t.imageCredit || 'SanjanaIAS category illustration') + '</p>' +
                '<div class="article-actions">' +
                '<button class="btn ' + (bm ? 'btn-primary' : '') + '" id="bmBtn" type="button">' + (bm ? '★ Saved' : '☆ Save to library') + '</button>' +
                '<a class="btn" href="/ai-tutor">Ask Sanjana AI about this</a>' +
                '<a class="btn" href="/prelims">Practise Prelims</a>' +
                '</div>' +
                '</header>' +
                '<div class="article-layout">' +
                '<div class="article-body">' +
                (t.whyItMatters && t.whyItMatters.indexOf('Add an editorial note') === -1 ? '<section class="art-sec" id="sec-why"><h2>Why it matters for UPSC</h2><p>' + esc(t.whyItMatters) + '</p></section>' : '') +
                ARTICLE_SECTIONS.map(function (pair) { return secHTML(pair[0], pair[1]); }).join('') +
                practiceHTML() +
                sourcesHTML() +
                '<section class="art-sec" id="sec-notes"><h2>My notes</h2>' +
                '<textarea id="noteBox" rows="5" placeholder="Write what you want to remember about this topic…">' + esc(note) + '</textarea>' +
                '<p class="fine">' + (SI_AUTH.user ? 'Notes are securely saved to your account.' : 'Log in to save notes to your account.') + '</p>' +
                '</section>' +
                '</div>' +
                '<nav class="toc" aria-label="On this page"><strong>On this page</strong>' +
                (t.whyItMatters ? '<a href="#sec-why" data-scroll-to="sec-why">Why it matters</a>' : '') +
                ARTICLE_SECTIONS.filter(function (p) {
                    var val = s[p[0]];
                    return val && (!Array.isArray(val) || val.length > 0);
                }).map(function (p) {
                    return '<a href="#sec-' + p[0] + '" data-scroll-to="sec-' + p[0] + '">' + esc(p[1]) + '</a>';
                }).join('') +
                '<a href="#sec-references" data-scroll-to="sec-references">References</a>' +
                '<a href="#sec-notes" data-scroll-to="sec-notes">My notes</a>' +
                '</nav>' +
                '</div>' +
                '</article>';

            document.getElementById('bmBtn').addEventListener('click', function () {
                if (!SI_AUTH.user) { _requireLogin('bookmark'); return; }
                var on = SI_STORE.toggleBookmark(t.id);
                this.textContent = on ? '★ Saved' : '☆ Save to library';
                this.classList.toggle('btn-primary', on);
                toast(on ? 'Saved to My Library.' : 'Removed from My Library.');
            });
            var box = document.getElementById('noteBox');
            box.addEventListener('change', function () {
                SI_STORE.saveNote(t.id, box.value);
                toast(SI_AUTH.user ? 'Note saved.' : 'Note saved locally (log in to sync).');
            });
            document.title = t.title + ' · SanjanaIAS';
        }
    };

    /* ============================================================
       9. Tutor + Revision
       ============================================================ */
    function intentOf(q) {
        var s = q.toLowerCase();
        if (/mcq|multiple choice|prelims question|quiz/.test(s)) return 'mcq';
        if (/mains question|answer writing|15 marks|250 words/.test(s)) return 'mains';
        if (/syllabus|gs paper|which paper/.test(s)) return 'syllabus';
        if (/affect india|india'?s? (interest|perspective|stand)/.test(s)) return 'india';
        if (/background|history|origin|why did/.test(s)) return 'background';
        if (/timeline|chronolog|what happened/.test(s)) return 'timeline';
        if (/simple|easy|beginner|explain/.test(s)) return 'explain';
        return 'general';
    }
    function buildFromTopic(t, intent) {
        var s = t.sections || {};
        var head = '<h3>' + esc(t.title) + '</h3><div class="chips">' + chips(t) + '</div>';
        var body = '';
        if (intent === 'background') {
            body = '<p>' + esc(stripHtml(s.background || t.summary)) + '</p>';
            if (s.causes) body += '<h4>Why it happened</h4><p>' + esc(s.causes) + '</p>';
        } else if (intent === 'india') {
            body = '<p>' + esc(s.india || 'No India-specific implication recorded yet.') + '</p>';
            if (s.telangana) body += '<h4>Telangana angle</h4><p>' + esc(s.telangana) + '</p>';
        } else if (intent === 'syllabus') {
            body = '<p>This topic is tagged to <strong>' + esc((t.gsPapers || []).join(', ') || 'no paper yet') + '</strong>.</p>' +
                '<p>' + esc(s.upsc || '') + '</p>';
            if ((s.prelimsNotes || []).length) body += '<h4>Prelims facts</h4><ul>' + s.prelimsNotes.slice(0, 4).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
        } else if (intent === 'timeline') {
            var tl = s.timeline || [];
            body = tl.length
                ? '<ol>' + tl.map(function (e) { return '<li><strong>' + esc(e.date) + '</strong> — ' + esc(e.text) + '</li>'; }).join('') + '</ol>'
                : '<p>No timeline recorded for this topic.</p>';
        } else if (intent === 'mcq') {
            var qs = SEED_QUESTIONS.prelims.filter(function (q) { return q.topicId === t.id; }).slice(0, 5);
            body = qs.length
                ? '<p>Practice questions from this topic:</p><ol>' + qs.map(function (q) { return '<li>' + esc(q.question) + '</li>'; }).join('') + '</ol>' +
                '<p><a class="btn" href="/prelims">Attempt with explanations</a></p>'
                : '<p>No MCQs authored for this topic yet.</p>';
        } else if (intent === 'mains') {
            var ms = SEED_QUESTIONS.mains.filter(function (q) { return q.topicId === t.id; }).slice(0, 2);
            body = ms.length ? ms.map(function (q) { return '<p><strong>' + q.marks + ' marks:</strong> ' + esc(q.question) + '</p>'; }).join('') : '<p>No Mains question attached to this topic yet.</p>';
        } else {
            body = '<p>' + esc(stripHtml(t.summary)) + '</p>';
            if (t.whyItMatters) body += '<h4>Why it matters for UPSC</h4><p>' + esc(stripHtml(t.whyItMatters)) + '</p>';
            if ((s.prelimsNotes || []).length) body += '<h4>Remember for Prelims</h4><ul>' + s.prelimsNotes.slice(0, 4).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
        }
        var srcs = (t.sources || []).slice(0, 3);
        var srcHTML = srcs.length
            ? '<div class="src">Sources: ' + srcs.map(function (sr) { return '<a href="' + esc(sr.url) + '" target="_blank" rel="noopener noreferrer">' + esc(sr.publisher) + '</a>'; }).join(' · ') + '</div>'
            : '';
        var related = SI_SEARCH.related(t, 3);
        var relHTML = related.length
            ? '<h4>Related in the library</h4><ul>' + related.map(function (r) { return '<li><a href="/article/' + encodeURIComponent(r.id) + '">' + esc(r.title) + '</a></li>'; }).join('') + '</ul>'
            : '';
        return head + body + srcHTML +
            '<p><a class="btn" href="/article/' + encodeURIComponent(t.id) + '">Read the full research page</a></p>' + relHTML;
    }
    var SI_TUTOR = {
        answer: function (q) {
            if (allTopics().length === 0) {
                return { html: '<p>No news collected yet. Please check back later.</p>' };
            }
            var intent = intentOf(q);
            var lower = q.toLowerCase();
            var hits = [];

            if (lower.includes('most important topic')) {
                hits = [{ topic: allTopics()[0], score: 100 }];
            } else if (lower.includes('affect india')) {
                hits = SI_SEARCH.query('india', { limit: 1 });
                intent = 'india';
            } else if (lower.includes('prelims mcq')) {
                hits = [{ topic: allTopics()[0], score: 100 }];
                intent = 'mcq';
            } else if (lower.includes('mains question')) {
                hits = [{ topic: allTopics()[0], score: 100 }];
                intent = 'mains';
            } else if (lower.includes('syllabus connection')) {
                hits = [{ topic: allTopics()[0], score: 100 }];
                intent = 'syllabus';
            } else {
                hits = SI_SEARCH.query(q, { limit: 3 });
            }
            if (!hits.length) {
                return {
                    html:
                        '<h3>Not in the library yet</h3><p>No content in the SanjanaIAS collection matches “' + esc(q) + '”.</p>' +
                        '<p>I only answer from content already collected here — I am not a general-purpose chatbot and I do not browse the internet.</p>' +
                        '<h4>Try one of these</h4><ul>' + allTopics().slice(0, 4).map(function (t) {
                            return '<li><a href="/article/' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a></li>';
                        }).join('') + '</ul>'
                };
            }
            var html = buildFromTopic(hits[0].topic, intent);
            if (hits.length > 1 && intent !== 'mcq' && intent !== 'mains') {
                html += '<h4>Also relevant</h4><ul>' + hits.slice(1).map(function (h) {
                    return '<li><a href="/article/' + encodeURIComponent(h.topic.id) + '">' + esc(h.topic.title) + '</a></li>';
                }).join('') + '</ul>';
            }
            html += '<div class="src">Grounded in ' + hits.length + ' SanjanaIAS topic' + (hits.length === 1 ? '' : 's') + '. No external model was used.</div>';
            return { html: html };
        }
    };

    var SI_REVISION = {
        render: function (root) {
            var cutoff30 = Date.now() - 30 * 86400000;
            var read = SI_STORE.read();
            var readIds = Object.keys(read)
                .filter(function (id) { return read[id] > cutoff30; })
                .sort(function (a, b) { return read[b] - read[a]; });
            var readTopics = readIds.map(getTopic).filter(Boolean);
            var missedMap = SI_STORE.missed();
            var missedQs = Object.keys(missedMap)
                .filter(function (id) { return missedMap[id] > cutoff30; })
                .map(function (id) { return SEED_QUESTIONS.prelims.filter(function (q) { return q.id === id; })[0]; })
                .filter(Boolean);
            var bookmarks = SI_STORE.bookmarks().map(getTopic).filter(Boolean);
            var weekAgo = Date.now() - 7 * 86400000;
            var thisWeek = allTopics().filter(function (t) { return new Date(t.published || 0).getTime() > weekAgo; });

            root.innerHTML =
                '<section class="panel"><div class="panel-head"><h2>Continue reading</h2><span class="chip">' + readTopics.length + ' read</span></div>' +
                (readTopics.length ? '<div class="card-grid">' + readTopics.slice(0, 6).map(card).join('') + '</div>' : '<p class="fine">Nothing read yet.</p>') +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>Questions to retry</h2><span class="chip">' + missedQs.length + '</span></div>' +
                (missedQs.length ? missedQs.map(function (q) {
                    return '<div class="list-row"><div class="lr-body"><h3>' + esc(q.question) + '</h3><p>' + esc(q.explanation) + '</p></div>' +
                        '<button class="btn" data-clear="' + esc(q.id) + '" type="button">Mark revised</button></div>';
                }).join('') : '<p class="fine">No missed questions.</p>') +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>Saved for later</h2><span class="chip">' + bookmarks.length + '</span></div>' +
                (bookmarks.length ? '<div class="card-grid">' + bookmarks.slice(0, 6).map(card).join('') + '</div>' : '<p class="fine">No bookmarks yet.</p>') +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>This week\'s collection</h2><span class="chip">' + thisWeek.length + '</span></div>' +
                (thisWeek.length ? '<div class="card-grid">' + byImportance(thisWeek).slice(0, 6).map(card).join('') + '</div>' : '<p class="fine">No new topics in the last seven days.</p>') +
                '</section>';

            $$('[data-clear]', root).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    SI_STORE.removeMissed(btn.dataset.clear);
                    toast('Removed from the retry list.');
                    SI_REVISION.render(root);
                });
            });
        }
    };

    /* ============================================================
       10. Pages
       ============================================================ */
    function sectionPage(region, container) {
        var todayStr = getTodayLocal();
        var topics = allTopics().filter(function (t) {
            return t.region === region || (Array.isArray(t.regions) && t.regions.indexOf(region) > -1);
        });

        container.innerHTML =
            '<header class="page-head">' +
            '<p class="eyebrow">' + esc(region === 'telangana' ? 'State Affairs' : region === 'india' ? 'National Affairs' : 'International Affairs') + '</p>' +
            '<h1>' + esc(regionLabel(region)) + '</h1>' +
            '<p class="lede">' + (region === 'world'
                ? 'Global developments organised by UPSC relevance.'
                : region === 'india'
                    ? 'Parliament, policy, economy, judiciary, science, environment and security.'
                    : 'A dedicated state research desk.') + '</p>' +
            '</header>' +
            '<div class="time-toggle" id="timeToggle" style="margin-bottom: 20px; display: flex; gap: 8px;">' +
            '<button class="btn btn-primary" data-time="daily" type="button">Today</button>' +
            '<button class="btn" data-time="weekly" type="button">This Week</button>' +
            '<button class="btn" data-time="all" type="button">All Time</button>' +
            '</div>' +
            '<div class="filter-bar">' +
            '<input type="search" id="localSearch" placeholder="Filter ' + regionLabel(region) + ' topics…" aria-label="Filter">' +
            '<select id="paperFilter" aria-label="Paper"><option value="">All papers</option><option>GS I</option><option>GS II</option><option>GS III</option><option>GS IV</option><option>Prelims</option></select>' +
            '<select id="sortFilter" aria-label="Sort"><option value="date">Newest first</option><option value="importance">Most important</option></select>' +
            '</div>' +
            '<p class="result-count" id="resultCount"></p>' +
            '<div class="card-grid" id="grid"></div>' +
            '<p class="disclaimer">Coverage includes relevant developments.</p>';

        var grid = $('#grid', container);
        var count = $('#resultCount', container);
        var search = $('#localSearch', container);
        var paper = $('#paperFilter', container);
        var sort = $('#sortFilter', container);
        var activeTime = 'daily';

        $('#timeToggle', container).addEventListener('click', function (e) {
            var btn = e.target.closest('button'); if (!btn) return;
            activeTime = btn.dataset.time;
            $('#timeToggle button', container).forEach(function (b) { b.classList.toggle('btn-primary', b === btn); });
            draw();
        });

        function draw() {
            var list = topics.slice();
            if (activeTime === 'daily') {
                list = list.filter(function (t) { return (t.published || '').slice(0, 10) === todayStr || t.curated; });
            } else if (activeTime === 'weekly') {
                var weekAgo = getWeekAgoLocal();
                list = list.filter(function (t) { return (t.published || '').slice(0, 10) >= weekAgo || t.curated; });
            }
            if (paper.value) list = list.filter(function (t) { return (t.gsPapers || []).indexOf(paper.value) > -1; });
            var q = search.value.trim().toLowerCase();
            if (q) list = list.filter(function (t) {
                return (t.title + ' ' + t.summary + ' ' + (t.tags || []).join(' ')).toLowerCase().indexOf(q) > -1;
            });
            list = sort.value === 'importance' ? byImportance(list) : byDate(list);
            grid.innerHTML = list.map(card).join('') || '<p class="fine">No news found for this timeframe.</p>';
            count.textContent = list.length + ' topic' + (list.length === 1 ? '' : 's') + ' in ' + regionLabel(region);
        }
        [search, paper, sort].forEach(function (el) { el.addEventListener('input', draw); });
        draw();
    }

    var Pages = {
        dashboard: function (main) {
            var todayStr = getTodayLocal();
            var weekAgo = getWeekAgoLocal();
            var activeTime = 'daily';

            function renderDash() {
                var topics = allTopics().filter(function (t) {
                    if (activeTime === 'daily') return (t.published || '').slice(0, 10) === todayStr || t.curated;
                    if (activeTime === 'weekly') return (t.published || '').slice(0, 10) >= weekAgo || t.curated;
                    return true; // all
                });
                var byRegion = function (r) { return topics.filter(function (t) { return t.region === r; }).length; };
                var ranked = byImportance(topics);
                var tod = ranked[0];

                main.innerHTML =
                    '<div class="time-toggle" id="dashTimeToggle" style="margin-bottom: 20px; display: flex; gap: 8px;">' +
                    '<button class="btn ' + (activeTime === 'daily' ? 'btn-primary' : '') + '" data-time="daily" type="button">Today</button>' +
                    '<button class="btn ' + (activeTime === 'weekly' ? 'btn-primary' : '') + '" data-time="weekly" type="button">This Week</button>' +
                    '<button class="btn ' + (activeTime === 'all' ? 'btn-primary' : '') + '" data-time="all" type="button">All Time</button>' +
                    '</div>' +
                    '<section class="hero-block">' +
                    '<p class="eyebrow" id="todayLabel"></p>' +
                    '<h1>' + (activeTime === 'daily' ? 'Daily' : activeTime === 'weekly' ? 'Weekly' : 'All-Time') + ' Overview</h1>' +
                    '<p class="lede">Your world. Your nation. Your state. Your preparation.</p>' +
                    '<div class="stat-row">' +
                    '<div class="stat"><strong>' + String(byRegion('world')).padStart(2, '0') + '</strong><span>World topics</span></div>' +
                    '<div class="stat"><strong>' + String(byRegion('india')).padStart(2, '0') + '</strong><span>India topics</span></div>' +
                    '<div class="stat"><strong>' + String(byRegion('telangana')).padStart(2, '0') + '</strong><span>Telangana topics</span></div>' +
                    '</div>' +
                    '</section>' +
                    '<section class="panel"><div class="panel-head"><h2>Most important topics</h2><a class="link" href="/briefing">Full briefing →</a></div>' +
                    '<div class="topic-list">' + (ranked.length ? ranked.slice(0, 5).map(function (t, i) { return listRow(t, i); }).join('') : '<p class="fine">No news collected for this timeframe.</p>') + '</div></section>' +
                    '<section class="split">' +
                    '<div class="panel"><div class="panel-head"><h2>Topic of the day</h2></div>' +
                    (tod ? '<a class="tod" href="/article/' + encodeURIComponent(tod.id) + '">' +
                        '<img src="' + esc(topicImage(tod)) + '" alt="" onerror="this.onerror=null; this.src=\'' + (ILLUSTRATIONS[tod.region] || ILLUSTRATIONS.default) + '\'">' +
                        '<div><div class="chips">' + chips(tod) + '</div>' +
                        '<h3>' + esc(tod.title) + '</h3><p>' + esc(tod.whyItMatters || tod.summary) + '</p>' +
                        '<span class="link">Open complete research →</span></div></a>' : '<p class="fine">No topics yet.</p>') +
                    '</div>' +
                    '<div class="panel"><div class="panel-head"><h2>Preparation plan</h2></div>' +
                    '<ul class="plan">' +
                    '<li><a href="/briefing">Read important topics</a><span>30 min</span></li>' +
                    '<li><a href="/prelims">Prelims practice</a><span>15 min</span></li>' +
                    '<li><a href="/mains">Mains answer practice</a><span>15 min</span></li>' +
                    '</ul>' +
                    '<p class="fine">Design example durations, not prescribed study time.</p>' +
                    '<a class="btn btn-primary block" href="/ai-tutor">Ask Sanjana AI about today\'s news</a>' +
                    '</div>' +
                    '</section>' +
                    '<section class="panel"><div class="panel-head"><h2>Browse by region</h2></div>' +
                    '<div class="region-tiles">' +
                    '<a class="region-tile world" href="/world"><span>World</span><small>' + byRegion('world') + ' topics</small></a>' +
                    '<a class="region-tile india" href="/india"><span>India</span><small>' + byRegion('india') + ' topics</small></a>' +
                    '<a class="region-tile telangana" href="/telangana"><span>Telangana</span><small>' + byRegion('telangana') + ' topics</small></a>' +
                    '</div>' +
                    '</section>' +
                    '<section class="panel"><div class="panel-head"><h2>Latest across SanjanaIAS</h2><a class="link" href="/world">All research →</a></div>' +
                    '<div class="card-grid">' + byDate(topics).slice(0, 6).map(card).join('') + '</div></section>' +
                    '<p class="disclaimer">SanjanaIAS is an independent educational platform. It is not affiliated with UPSC or the Government of India.</p>';

                var el = $('#todayLabel');
                if (el) el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

                $('#dashTimeToggle').addEventListener('click', function (e) {
                    var btn = e.target.closest('button'); if (!btn) return;
                    activeTime = btn.dataset.time;
                    renderDash();
                });
            }

            renderDash();
        },

        weekly: function (main) {
            var weekAgo = getWeekAgoLocal();
            var topics = allTopics().filter(function (t) { return (t.published || '').slice(0, 10) >= weekAgo || t.curated; });
            var byRegion = function (r) { return topics.filter(function (t) { return t.region === r; }).length; };
            var ranked = byImportance(topics);
            var tod = ranked[0];

            main.innerHTML =
                '<section class="hero-block">' +
                '<p class="eyebrow" id="weeklyLabel"></p>' +
                '<h1>Weekly Overview</h1>' +
                '<p class="lede">Your world. Your nation. Your state. Your preparation. (Showing news from the last 7 days)</p>' +
                '<div class="stat-row">' +
                '<div class="stat"><strong>' + String(byRegion('world')).padStart(2, '0') + '</strong><span>World topics</span></div>' +
                '<div class="stat"><strong>' + String(byRegion('india')).padStart(2, '0') + '</strong><span>India topics</span></div>' +
                '<div class="stat"><strong>' + String(byRegion('telangana')).padStart(2, '0') + '</strong><span>Telangana topics</span></div>' +
                '</div>' +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>This Week\'s Most Important Topics</h2><a class="link" href="/briefing">Full briefing →</a></div>' +
                '<div class="topic-list">' + ranked.slice(0, 5).map(function (t, i) { return listRow(t, i); }).join('') + '</div></section>' +
                '<section class="split">' +
                '<div class="panel"><div class="panel-head"><h2>Topic of the week</h2></div>' +
                (tod ? '<a class="tod" href="/article/' + encodeURIComponent(tod.id) + '">' +
                    '<img src="' + esc(topicImage(tod)) + '" alt="" onerror="this.onerror=null; this.src=\'' + (ILLUSTRATIONS[tod.region] || ILLUSTRATIONS.default) + '\'">' +
                    '<div><div class="chips">' + chips(tod) + '</div>' +
                    '<h3>' + esc(tod.title) + '</h3><p>' + esc(tod.whyItMatters || tod.summary) + '</p>' +
                    '<span class="link">Open complete research →</span></div></a>' : '<p class="fine">No topics yet.</p>') +
                '</div>' +
                '<div class="panel"><div class="panel-head"><h2>Weekly preparation plan</h2></div>' +
                '<ul class="plan">' +
                '<li><a href="/briefing">Read important topics</a><span>30 min/day</span></li>' +
                '<li><a href="/prelims">Prelims practice</a><span>15 min/day</span></li>' +
                '<li><a href="/mains">Mains answer practice</a><span>15 min/day</span></li>' +
                '</ul>' +
                '<p class="fine">Design example durations, not prescribed study time.</p>' +
                '<a class="btn btn-primary block" href="/ai-tutor">Ask Sanjana AI about this week\'s news</a>' +
                '</div>' +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>Browse by region</h2></div>' +
                '<div class="region-tiles">' +
                '<a class="region-tile world" href="/world"><span>World</span><small>' + byRegion('world') + ' topics</small></a>' +
                '<a class="region-tile india" href="/india"><span>India</span><small>' + byRegion('india') + ' topics</small></a>' +
                '<a class="region-tile telangana" href="/telangana"><span>Telangana</span><small>' + byRegion('telangana') + ' topics</small></a>' +
                '</div>' +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>Latest across SanjanaIAS</h2><a class="link" href="/world">All research →</a></div>' +
                '<div class="card-grid">' + byDate(topics).slice(0, 6).map(card).join('') + '</div></section>' +
                '<p class="disclaimer">SanjanaIAS is an independent educational platform. It is not affiliated with UPSC or the Government of India. Sample topics marked <em>illustrative</em> demonstrate layout and classification.</p>';

            var el = $('#weeklyLabel');
            if (el) el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        },
        subjects: function (main) {
            var todayStr = getTodayLocal();
            var activeTime = 'daily';

            var subjects = [
                { name: 'Indian Polity & Governance', keywords: ['polity', 'governance', 'constitution'] },
                { name: 'Indian Economy & Agriculture', keywords: ['economy', 'agriculture', 'banking'] },
                { name: 'Environment & Ecology', keywords: ['environment', 'ecology', 'climate'] },
                { name: 'Science & Technology', keywords: ['science & technology', 'science', 'technology'] },
                { name: 'International Relations', keywords: ['international relations'] },
                { name: 'History, Art & Culture', keywords: ['history', 'art & culture', 'culture'] },
                { name: 'Geography & Disaster Management', keywords: ['geography', 'disaster'] },
                { name: 'Social Issues & Schemes', keywords: ['social', 'welfare', 'scheme'] }
            ];

            function renderSubjects() {
                var html = '<header class="page-head"><p class="eyebrow">UPSC Core Subjects</p><h1>Subject-wise Current Affairs</h1><p class="lede">Current affairs integrated directly across the core syllabus.</p></header>' +
                    '<div class="time-toggle" id="subTimeToggle" style="margin-bottom: 20px; display: flex; gap: 8px;">' +
                    '<button class="btn ' + (activeTime === 'daily' ? 'btn-primary' : '') + '" data-time="daily" type="button">Today</button>' +
                    '<button class="btn ' + (activeTime === 'weekly' ? 'btn-primary' : '') + '" data-time="weekly" type="button">This Week</button>' +
                    '<button class="btn ' + (activeTime === 'all' ? 'btn-primary' : '') + '" data-time="all" type="button">All Time</button>' +
                    '</div>';

                var weekAgo = getWeekAgoLocal();

                subjects.forEach(function (subj) {
                    var matchedTopics = allTopics().filter(function (t) {
                        // Apply Time Filter first
                        if (activeTime === 'daily' && (t.published || '').slice(0, 10) !== todayStr && !t.curated) return false;
                        if (activeTime === 'weekly' && (t.published || '').slice(0, 10) < weekAgo && !t.curated) return false;

                        // Apply Subject Filter
                        var text = (t.category + ' ' + (t.tags || []).join(' ')).toLowerCase();
                        return subj.keywords.some(function (k) { return text.indexOf(k) > -1; });
                    });

                    html += '<section class="panel"><div class="panel-head"><h2>' + subj.name + '</h2><span class="chip">' + matchedTopics.length + ' topics</span></div>';
                    if (matchedTopics.length) {
                        html += '<div class="card-grid">' + matchedTopics.slice(0, 6).map(card).join('') + '</div>';
                    } else {
                        html += '<p class="fine">No topics found for this subject in the selected timeframe.</p>';
                    }
                    html += '</section>';
                });

                main.innerHTML = html;

                $('#subTimeToggle').addEventListener('click', function (e) {
                    var btn = e.target.closest('button'); if (!btn) return;
                    activeTime = btn.dataset.time;
                    renderSubjects();
                });
            }

            renderSubjects();
        },

        world: function (main) { sectionPage('world', main); },

        india: function (main) { sectionPage('india', main); },
        telangana: function (main) { sectionPage('telangana', main); },

        briefing: function (main) {
            var topics = allTopics();
            var ranked = byImportance(topics);
            var tod = ranked[0];
            var facts = [];
            topics.forEach(function (t) { (t.sections && t.sections.data || []).forEach(function (d) { facts.push({ data: d, topic: t }); }); });

            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">Consolidated daily report</p><h1>Daily Briefing</h1>' +
                '<p class="lede">' + new Date().toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) + '</p></header>' +
                '<section class="panel"><div class="panel-head"><h2>Part A — Today\'s most important topics</h2></div>' +
                '<div class="topic-list">' + (ranked.slice(0, 6).map(function (t, i) { return listRow(t, i); }).join('') || '<p class="fine">No topics collected yet.</p>') + '</div></section>' +
                '<section class="panel"><div class="panel-head"><h2>Part B — Geographic summaries</h2></div>' +
                '<div class="three-col">' +
                ['world', 'india', 'telangana'].map(function (r) {
                    var list = byImportance(topics.filter(function (t) { return t.region === r; })).slice(0, 3);
                    return '<div class="mini-col"><h3>' + regionLabel(r) + '</h3><ul class="mini-list">' +
                        (list.length ? list.map(function (t) {
                            return '<li><a href="/article?id=' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a></li>';
                        }).join('') : '<li class="fine">Nothing collected yet.</li>') + '</ul></div>';
                }).join('') +
                '</div></section>' +
                '<section class="panel"><div class="panel-head"><h2>Part C — Topic of the day, in depth</h2></div>' +
                (tod ? '<h3>' + esc(tod.title) + '</h3><div class="chips">' + chips(tod) + '</div>' +
                    '<p>' + esc(tod.sections && tod.sections.event || tod.summary) + '</p>' +
                    '<p class="fine">' + esc(tod.sections && tod.sections.india || '') + '</p>' +
                    '<a class="btn" href="/article/' + encodeURIComponent(tod.id) + '">Read the full research page</a>'
                    : '<p class="fine">No topic available.</p>') +
                '</section>' +
                '<section class="panel"><div class="panel-head"><h2>Part D — Important facts</h2></div>' +
                '<ul class="fact-list">' +
                (facts.slice(0, 8).map(function (f) {
                    return '<li><strong>' + esc(f.data.label) + ':</strong> ' + esc(f.data.value) +
                        ' <a class="mini-link" href="/article/' + encodeURIComponent(f.topic.id) + '">source</a></li>';
                }).join('') || '<li class="fine">No facts collected yet.</li>') +
                '</ul></section>' +
                '<section class="split">' +
                '<div class="panel"><div class="panel-head"><h2>Part E — Daily quiz</h2></div>' +
                '<p class="fine">Questions drawn from the day\'s collected topics.</p>' +
                '<a class="btn btn-primary" href="/prelims">Start today\'s quiz</a></div>' +
                '<div class="panel"><div class="panel-head"><h2>Part F — Daily revision</h2></div>' +
                '<p class="fine">A quick recap of topics you previously studied.</p>' +
                '<a class="btn" href="/revision">Open revision tracker</a></div>' +
                '</section>' +
                '<p class="disclaimer">Counts reflect the current local library.</p>';
        },

        article: function (main, params) {
            SI_ARTICLE.render(main, params.id);
        },

        syllabus: function (main) {
            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">GS Paper I – IV mapping</p><h1>Syllabus Explorer</h1>' +
                '<p class="lede">Each topic is tagged to a GS paper and to Prelims-relevant facts. This view reverses the mapping.</p></header>' +
                State.syllabus.map(function (p) {
                    var linked = allTopics().filter(function (t) { return (t.gsPapers || []).indexOf(p.code) > -1; });
                    return '<details class="panel syllabus-block" ' + (p.code === 'GS II' ? 'open' : '') + '>' +
                        '<summary><strong>' + esc(p.code) + '</strong> — ' + esc(p.name) + ' <span class="chip">' + linked.length + ' topics</span></summary>' +
                        '<p class="fine">' + esc(p.note || '') + '</p>' +
                        '<ul class="syllabus-areas">' + p.areas.map(function (a) { return '<li><strong>' + esc(a) + '</strong></li>'; }).join('') + '</ul>' +
                        '<div class="card-grid compact">' +
                        (linked.slice(0, 6).map(card).join('') || '<p class="fine">No topics collected for this paper yet.</p>') +
                        '</div></details>';
                }).join('') +
                '<p class="disclaimer">Syllabus areas are maintained from official UPSC notification headings. Topic counts reflect only content collected by SanjanaIAS.</p>';
        },

        'ai-tutor': function (main) {
            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">UPSC-focused learning assistant</p><h1>Sanjana AI Tutor</h1>' +
                '<p class="lede">Answers are retrieved from the SanjanaIAS library and cite their sources. It is a grounded study assistant, not a general-purpose chatbot.</p></header>' +
                '<div class="notice"><strong>How this works:</strong> Sanjana AI searches topics already collected by SanjanaIAS and builds an answer from their summaries, notes and sources. No external language model is connected — it cannot reason about content outside this library, and it will say so.</div>' +
                '<div class="chat-shell">' +
                '<div class="chat-log" id="chatLog" aria-live="polite"></div>' +
                '<form class="chat-form" id="chatForm">' +
                '<input id="chatInput" type="text" autocomplete="off" placeholder="Ask about a topic, e.g. “Why is the Strait of Hormuz important for India?”" aria-label="Ask Sanjana">' +
                '<button class="btn btn-primary" type="submit">Ask</button>' +
                '</form>' +
                '<div class="suggestions" id="suggestions"></div>' +
                '</div>';

            var log = $('#chatLog', main);
            var input = $('#chatInput', main);
            var form = $('#chatForm', main);
            var sug = $('#suggestions', main);

            function add(html, cls) {
                var div = document.createElement('div');
                div.className = 'msg ' + (cls || '');
                div.innerHTML = html;
                log.appendChild(div);
                log.scrollTop = log.scrollHeight;
                return div;
            }
            add('<p>Hello. Ask me about any topic in today\'s library — I will point you to the summary, the UPSC relevance and the original sources.</p>', 'bot');

            var presets = ['Explain today\'s most important topic', 'How does this affect India?', 'Give me 5 Prelims MCQs', 'Ask me a difficult Mains question', 'What is the syllabus connection?'];
            sug.innerHTML = presets.map(function (p) { return '<button class="chip chip-btn" type="button">' + esc(p) + '</button>'; }).join('');
            sug.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) return;
                input.value = b.textContent; form.requestSubmit();
            });
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var q = input.value.trim(); if (!q) return;

                // Limit guests to 1 question
                if (!SI_AUTH.user && _getGuestCount('tutor') >= 3) {
                    _requireLogin('ask more questions');
                    return;
                }
                if (!SI_AUTH.user) _incGuestCount('tutor');

                add('<p class="you">' + esc(q) + '</p>', 'user');
                input.value = '';
                var pending = add('<p class="typing">Searching the SanjanaIAS library…</p>', 'bot');
                setTimeout(function () {
                    pending.innerHTML = SI_TUTOR.answer(q).html;
                }, 260);
            });
        },

        prelims: function (main) {
            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">MCQs and factual revision</p><h1>Prelims Practice</h1>' +
                '<p class="lede">Select a timeframe, fetch the topics, and start your quiz.</p></header>' +

                '<div class="panel" id="prelimsFilterPanel" style="margin-bottom: 24px;">' +
                '<div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">' +
                '<div style="flex: 1; min-width: 150px;">' +
                '<label class="field-label" style="font-size: 0.75rem; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; display: block;">Scope</label>' +
                '<select id="quizScope" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text);">' +
                '<option value="today">Today\'s News</option>' +
                '<option value="week">This Week\'s News</option>' +
                '<option value="all">All Collected</option>' +
                '</select>' +
                '</div>' +
                '<div style="flex: 1; min-width: 150px;">' +
                '<label class="field-label" style="font-size: 0.75rem; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; display: block;">Specific Date</label>' +
                '<input type="date" id="quizDate" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text);">' +
                '</div>' +
                '<button class="btn btn-primary" id="fetchBtn" style="height: 42px;">Fetch Topics</button>' +
                '</div></div>' +

                '<div id="fetchResults" style="display: none;">' +
                '<div class="panel" style="text-align: center;">' +
                '<h3 id="fetchMsg" style="margin-top: 0;">Found 0 questions</h3>' +
                '<div class="row-actions" style="justify-content: center;">' +
                '<button class="btn btn-primary" id="startQuizBtn">Start Quiz</button>' +
                '<button class="btn" id="allQuestionsBtn">Show All Questions</button>' +
                '</div>' +
                '</div>' +
                '</div>' +

                '<div id="quizStage" class="panel" style="display: none;"></div>' +
                '<div id="quizResult"></div>';

            var bank = SEED_QUESTIONS.prelims;
            var stage = $('#quizStage', main);
            var result = $('#quizResult', main);
            var fetchResults = $('#fetchResults', main);
            var filterPanel = $('#prelimsFilterPanel', main);
            var fetchedQuestions = [];

            $('#fetchBtn', main).addEventListener('click', function () {
                var scope = $('#quizScope', main).value;
                var specificDate = $('#quizDate', main).value;

                var validTopicIds = allTopics().filter(function (t) {
                    var pub = (t.published || '').slice(0, 10);
                    if (specificDate) return pub === specificDate;
                    if (scope === 'today') return pub === getTodayLocal() || t.curated;
                    if (scope === 'week') return pub >= getWeekAgoLocal() || t.curated;
                    return true; // all
                }).map(function (t) { return t.id; });

                fetchedQuestions = bank.filter(function (q) { return validTopicIds.indexOf(q.topicId) > -1; });

                $('#fetchMsg', main).textContent = 'Found ' + fetchedQuestions.length + ' questions for this filter.';
                fetchResults.style.display = 'block';
                stage.style.display = 'none';
                result.innerHTML = '';
            });

            $('#allQuestionsBtn', main).addEventListener('click', function () {
                fetchedQuestions = bank.slice();
                $('#fetchMsg', main).textContent = 'Using all ' + fetchedQuestions.length + ' questions in the library.';
            });

            var state = null;
            $('#startQuizBtn', main).addEventListener('click', function () {
                if (!fetchedQuestions.length) { toast('No questions found for this filter.'); return; }

                if (!SI_AUTH.user && _getGuestCount('quiz') >= 3) {
                    _requireLogin('take another quiz');
                    return;
                }
                if (!SI_AUTH.user) _incGuestCount('quiz');

                filterPanel.style.display = 'none';
                fetchResults.style.display = 'none';
                stage.style.display = 'block';

                var pool = shuffle(fetchedQuestions).slice(0, 10);
                state = { list: pool, i: 0, score: 0, answered: false, answers: [] };
                result.innerHTML = '';
                render();
            });

            function render() {
                var q = state.list[state.i];
                var topic = getTopic(q.topicId);
                stage.innerHTML =
                    '<div class="quiz-meta"><span class="chip">Question ' + (state.i + 1) + ' / ' + state.list.length + '</span>' +
                    '<span class="chip">' + esc(q.paper) + '</span>' +
                    (topic ? '<a class="chip chip-link" href="/article/' + encodeURIComponent(topic.id) + '">' + esc(topic.title.slice(0, 48)) + '…</a>' : '') + '</div>' +
                    '<h2 class="quiz-q">' + esc(q.question) + '</h2>' +
                    '<div class="options" id="options">' +
                    q.options.map(function (o, idx) {
                        return '<button class="option" data-idx="' + idx + '" type="button"><span class="opt-key">' + 'abcd'[idx] + '</span>' + esc(o) + '</button>';
                    }).join('') +
                    '</div>' +
                    '<div id="feedback" aria-live="polite"></div>' +
                    '<div class="quiz-actions"><button class="btn btn-primary" id="nextQ" disabled>Next</button></div>';

                $('#options', stage).addEventListener('click', function (e) {
                    var b = e.target.closest('.option'); if (!b || state.answered) return;
                    var pick = Number(b.dataset.idx);
                    state.answered = true;
                    var correct = pick === q.answer;
                    if (correct) state.score++;
                    state.answers.push({ qid: q.id, pick: pick, correct: correct });
                    $$('.option', stage).forEach(function (el, idx) {
                        el.classList.add('locked');
                        if (idx === q.answer) el.classList.add('correct');
                        if (idx === pick && !correct) el.classList.add('wrong');
                    });
                    $('#feedback', stage).innerHTML = '<div class="explain ' + (correct ? 'ok' : 'bad') + '"><strong>' + (correct ? 'Correct.' : 'Not quite.') + '</strong> ' + esc(q.explanation) + '</div>';
                    if (!correct) SI_STORE.addMissed(q.id);
                    var next = $('#nextQ', stage);
                    next.disabled = false;
                    next.textContent = state.i + 1 < state.list.length ? 'Next question' : 'Finish';
                });
                $('#nextQ', stage).addEventListener('click', function () {
                    state.i++; state.answered = false;
                    if (state.i < state.list.length) render(); else finish();
                });
            }

            function finish() {
                var total = state.list.length;
                var pct = Math.round((state.score / total) * 100);
                SI_STORE.saveQuiz({ at: Date.now(), score: state.score, total: total, answers: state.answers });
                stage.style.display = 'none';
                result.innerHTML = '<div class="panel score-panel"><h2>' + state.score + ' / ' + total + ' correct — ' + pct + '%</h2>' +
                    '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
                    '<p class="fine">Wrong answers were added to your revision list.</p>' +
                    '<div class="row-actions"><a class="btn" href="/revision">Review missed questions</a>' +
                    '<button class="btn btn-primary" id="againBtn" type="button">Start Over</button></div></div>';
                $('#againBtn', result).addEventListener('click', function () {
                    filterPanel.style.display = 'block';
                    result.innerHTML = '';
                    fetchedQuestions = [];
                });
            }
        },

        mains: function (main) {
            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">Analytical questions and answer writing</p><h1>Mains Practice</h1>' +
                '<p class="lede">Write your answer, check it against a structured self-evaluation list, then compare with the model approach.</p></header>' +
                '<div class="filter-bar" id="mainsFilters" style="margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap;">' +
                '<button class="btn btn-primary" data-paper="" type="button">All</button>' +
                '<button class="btn" data-paper="GS I" type="button">GS I</button>' +
                '<button class="btn" data-paper="GS II" type="button">GS II</button>' +
                '<button class="btn" data-paper="GS III" type="button">GS III</button>' +
                '<button class="btn" data-paper="GS IV" type="button">GS IV</button>' +
                '</div>' +
                '<div class="mains-layout">' +
                '<div class="mains-list" id="mainsList"></div>' +
                '<div class="mains-work" id="mainsWork"><p class="fine">Select a question to begin.</p></div>' +
                '</div>' +
                '<p class="disclaimer">Automated answer evaluation requires a language model. Until one is connected, SanjanaIAS provides a structured self-evaluation checklist — it does not grade your answer.</p>';

            var bank = SEED_QUESTIONS.mains;
            var list = $('#mainsList', main);
            var work = $('#mainsWork', main);
            var saved = SI_STORE.mains();

            function renderMainsList(paper) {
                var filtered = paper ? bank.filter(function (q) { return q.paper === paper; }) : bank;
                list.innerHTML = filtered.map(function (q) {
                    return '<button class="mains-item" data-id="' + q.id + '" type="button">' +
                        '<span class="chip">' + esc(q.paper) + '</span>' +
                        '<span class="chip">' + q.marks + ' marks</span>' +
                        (saved[q.id] ? '<span class="chip chip-ok">draft saved</span>' : '') +
                        '<p>' + esc(q.question) + '</p></button>';
                }).join('') || '<p class="fine">No Mains questions for this paper.</p>';
            }
            renderMainsList('');
            $('#mainsFilters', main).addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) return;
                $('#mainsFilters button', main).forEach(function (x) { x.classList.toggle('btn-primary', x === b); });
                renderMainsList(b.dataset.paper);
            });

            list.addEventListener('click', function (e) {
                var b = e.target.closest('.mains-item'); if (!b) return;
                renderQ(b.dataset.id);
            });

            function renderQ(id) {
                var q = bank.filter(function (x) { return x.id === id; })[0]; if (!q) return;
                var topic = getTopic(q.topicId);
                var draft = (SI_STORE.mains()[id] || {});
                work.innerHTML =
                    '<h2>' + esc(q.question) + '</h2>' +
                    '<div class="chips"><span class="chip">' + esc(q.paper) + '</span><span class="chip">' + q.marks + ' marks</span>' +
                    (topic ? '<a class="chip chip-link" href="/article/' + encodeURIComponent(topic.id) + '">' + esc(topic.title.slice(0, 50)) + '…</a>' : '') + '</div>' +
                    '<label class="field-label" for="answerBox">Your answer</label>' +
                    '<textarea id="answerBox" class="answer-box" placeholder="Introduction → body → challenges → way forward → conclusion">' + esc(draft.text || '') + '</textarea>' +
                    '<div class="word-count"><span id="wordCount">0</span> words · target ' + (q.marks === 15 ? 250 : q.marks * 15) + '</div>' +
                    '<h3>Self-evaluation checklist</h3>' +
                    '<ul class="checklist" id="checklist">' +
                    (q.checklist || []).map(function (c, i) {
                        return '<li><label><input type="checkbox" data-i="' + i + '" ' + (draft['c' + i] ? 'checked' : '') + '> ' + esc(c) + '</label></li>';
                    }).join('') +
                    '</ul>' +
                    '<div class="row-actions"><button class="btn btn-primary" id="saveBtn" type="button">Save draft</button>' +
                    '<button class="btn" id="revealBtn" type="button">Show model approach</button></div>' +
                    '<div id="approachBox" hidden><h3>Model approach</h3>' +
                    '<p><strong>Introduction:</strong> ' + esc(q.approach.intro) + '</p>' +
                    '<ol>' + q.approach.body.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ol>' +
                    '<p><strong>Conclusion:</strong> ' + esc(q.approach.conclusion) + '</p></div>';

                var box = $('#answerBox', work);
                var wc = $('#wordCount', work);
                function update() { wc.textContent = box.value.trim().split(/\s+/).filter(Boolean).length; }
                box.addEventListener('input', update); update();

                $('#saveBtn', work).addEventListener('click', function () {
                    var data = { text: box.value };
                    $$('#checklist input', work).forEach(function (inp) { data['c' + inp.dataset.i] = inp.checked; });
                    SI_STORE.saveMains(id, data);
                    toast('Draft saved to My Library.');
                });
                $('#revealBtn', work).addEventListener('click', function () {
                    $('#approachBox', work).hidden = false;
                });
            }
        },

        library: function (main) {
            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">Saved and personal</p><h1>My Library</h1>' +
                '<p class="lede">Bookmarks, notes and Mains drafts synced to your account.</p></header>' +
                '<div class="tabs" id="tabs">' +
                '<button class="tab active" data-tab="bookmarks" type="button">Bookmarks</button>' +
                '<button class="tab" data-tab="notes" type="button">Notes</button>' +
                '<button class="tab" data-tab="mains" type="button">Mains drafts</button>' +
                '<button class="tab" data-tab="reset" type="button">Data</button>' +
                '</div>' +
                '<div id="tabBody"></div>';

            var body = $('#tabBody', main);
            function draw(tab) {
                if (tab === 'bookmarks') {
                    var bmIds = SI_STORE.bookmarks();
                    body.innerHTML = '<div class="card-grid">' + (bmIds.map(function (id) {
                        var t = getTopic(id);
                        if (!t) {
                            return '<div class="panel" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">' +
                                '<span class="fine">Topic no longer available (expired)</span>' +
                                '<button class="btn btn-sm danger" data-del-bm="' + esc(id) + '" type="button">Delete</button></div>';
                        }
                        return '<div class="bm-wrap">' + card(t) +
                            '<button class="btn btn-sm danger" data-del-bm="' + esc(t.id) + '" type="button">Delete bookmark</button></div>';
                    }).join('') || '<p class="fine">Nothing bookmarked yet. Use the ☆ on any card.</p>') + '</div>';
                    $$('[data-del-bm]', body).forEach(function (b) {
                        b.addEventListener('click', function () {
                            SI_STORE.deleteBookmark(b.dataset.delBm);
                            toast('Bookmark deleted.');
                            draw('bookmarks');
                        });
                    });
                } else if (tab === 'notes') {
                    var notes = SI_STORE.notes();
                    var noteIds = Object.keys(notes);
                    body.innerHTML = noteIds.map(function (id) {
                        var t = getTopic(id);
                        var heading = t
                            ? '<h3><a href="/article/' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a></h3>'
                            : '<p class="fine">Topic no longer available</p>';
                        return '<div class="panel note-row">' + heading +
                            '<textarea data-note="' + esc(id) + '" rows="4">' + esc(notes[id].text) + '</textarea>' +
                            '<p class="fine">Last saved ' + fmtDate(new Date(notes[id].at).toISOString()) + '</p>' +
                            '<button class="btn btn-sm danger" data-del-note="' + esc(id) + '" type="button">Delete note</button></div>';
                    }).join('') || '<p class="fine">No notes yet.</p>';
                    $$('textarea[data-note]', body).forEach(function (ta) {
                        ta.addEventListener('change', function () { SI_STORE.saveNote(ta.dataset.note, ta.value); toast('Note saved.'); });
                    });
                    $$('[data-del-note]', body).forEach(function (b) {
                        b.addEventListener('click', function () {
                            if (!confirm('Delete this note?')) return;
                            SI_STORE.deleteNote(b.dataset.delNote);
                            toast('Note deleted.');
                            draw('notes');
                        });
                    });
                } else if (tab === 'mains') {
                    var drafts = SI_STORE.mains();
                    var rows2 = Object.keys(drafts).map(function (id) { return { q: SEED_QUESTIONS.mains.filter(function (q) { return q.id === id; })[0], d: drafts[id] }; }).filter(function (r) { return r.q; });
                    body.innerHTML = rows2.map(function (r) {
                        return '<div class="panel"><p class="fine">' + esc(r.q.paper) + ' · ' + r.q.marks + ' marks</p>' +
                            '<h3>' + esc(r.q.question) + '</h3>' +
                            '<p class="answer-preview">' + esc((r.d.text || '').slice(0, 400)) + ((r.d.text || '').length > 400 ? '…' : '') + '</p>' +
                            '<div class="row-actions"><a class="btn" href="/mains">Continue writing →</a>' +
                            '<button class="btn btn-sm danger" data-del-mains="' + r.q.id + '" type="button">Delete draft</button></div></div>';
                    }).join('') || '<p class="fine">No Mains drafts saved.</p>';
                    $$('[data-del-mains]', body).forEach(function (b) {
                        b.addEventListener('click', function () {
                            if (!confirm('Delete this draft?')) return;
                            SI_STORE.deleteMains(b.dataset.delMains);
                            toast('Draft deleted.');
                            draw('mains');
                        });
                    });
                } else if (tab === 'reset') {
                    body.innerHTML = '<div class="panel"><h3>Local data</h3>' +
                        '<p class="fine">Erase your bookmarks, notes, drafts and progress.</p>' +
                        '<button class="btn danger" id="resetBtn" type="button">Erase all my data</button></div>';
                    $('#resetBtn', body).addEventListener('click', async function () {
                        if (confirm('Erase bookmarks, notes, drafts and progress?')) {
                            await SI_STORE.reset();
                            if (!SI_AUTH.user) {
                                localStorage.removeItem('sanjana.guest_quiz');
                                localStorage.removeItem('sanjana.guest_tutor');
                            }
                            toast('All data erased.');
                            draw('bookmarks');
                        }
                    });
                }
            }
            $('#tabs', main).addEventListener('click', function (e) {
                var b = e.target.closest('.tab'); if (!b) return;
                $$('.tab', main).forEach(function (t) { t.classList.toggle('active', t === b); });
                draw(b.dataset.tab);
            });
            draw('bookmarks');
        },

        revision: function (main) {
            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">Daily · Weekly · Monthly</p><h1>Revision</h1>' +
                '<p class="lede">Read topics and missed questions from the last 30 days. Older entries drop off automatically.</p></header>' +
                '<div id="revisionRoot"></div>';
            SI_REVISION.render($('#revisionRoot', main));
        },

        progress: function (main) {
            var topics = allTopics();
            var read = SI_STORE.read();
            var days = SI_STORE.days();
            var quiz = SI_STORE.quiz();
            var bm = SI_STORE.bookmarks();
            var missed = SI_STORE.missed();
            var readCount = topics.filter(function (t) { return read[t.id]; }).length;
            var pct = topics.length ? Math.round((readCount / topics.length) * 100) : 0;

            function regionBar(r) {
                var all = topics.filter(function (t) { return t.region === r; });
                var done = all.filter(function (t) { return read[t.id]; }).length;
                var p = all.length ? Math.round((done / all.length) * 100) : 0;
                return '<div class="progress-row"><span>' + regionLabel(r) + '</span><div class="bar"><span style="width:' + p + '%"></span></div><span class="fine">' + done + '/' + all.length + '</span></div>';
            }

            main.innerHTML =
                '<header class="page-head"><p class="eyebrow">Study and practice history</p><h1>Progress</h1>' +
                '<p class="lede">A private record of what you have read and practised, synced to your account.</p></header>' +
                '<div class="stat-row">' +
                '<div class="stat"><strong>' + readCount + '</strong><span>topics read</span></div>' +
                '<div class="stat"><strong>' + bm.length + '</strong><span>bookmarks</span></div>' +
                '<div class="stat"><strong>' + (quiz.best || 0) + '</strong><span>best quiz score</span></div>' +
                '<div class="stat"><strong>' + days.length + '</strong><span>active days</span></div>' +
                '</div>' +
                '<div class="panel"><h2>Library coverage</h2>' +
                '<div class="progress-row"><span>Overall</span><div class="bar"><span style="width:' + pct + '%"></span></div><span class="fine">' + pct + '%</span></div>' +
                regionBar('world') + regionBar('india') + regionBar('telangana') +
                '</div>' +
                '<div class="panel"><h2>Recent quiz attempts</h2>' +
                ((quiz.attempts || []).slice(-8).reverse().map(function (a) {
                    return '<div class="attempt"><span>' + fmtDate(new Date(a.at).toISOString()) + '</span><strong>' + a.score + '/' + a.total + '</strong></div>';
                }).join('') || '<p class="fine">No attempts yet.</p>') +
                '</div>' +
                '<div class="panel"><h2>Needs another review</h2>' +
                (Object.keys(missed).length ? '<a class="btn" href="/revision">' + Object.keys(missed).length + ' missed questions →</a>' : '<p class="fine">Nothing flagged. Good.</p>') +
                '</div>';
        }
    };

    /* ============================================================
       11. Shell wiring + router + boot
       ============================================================ */
    var PAGE_TITLES = {
        dashboard: 'Daily Overview', weekly: 'Weekly Overview', subjects: 'Subjects', world: 'World', india: 'India', telangana: 'Telangana',
        briefing: 'Daily Briefing', article: 'Research', syllabus: 'Syllabus Explorer',
        'ai-tutor': 'Sanjana AI Tutor', prelims: 'Prelims Practice', mains: 'Mains Practice',
        library: 'My Library', revision: 'Revision', progress: 'Progress'
    };

    function parsePath() {
        var path = window.location.pathname.slice(1); // Remove leading slash
        if (!path || path === 'index.html') return { page: 'dashboard', params: {} };

        var parts = path.split('/');
        var page = parts[0] || 'dashboard';
        var params = {};

        // Handle /article/slug-name
        if (page === 'article' && parts[1]) {
            params.id = decodeURIComponent(parts[1]);
        }

        // Handle query strings if any remain
        var qIdx = window.location.search.indexOf('?');
        if (qIdx > -1) {
            var query = window.location.search.slice(qIdx + 1);
            query.split('&').filter(Boolean).forEach(function (pair) {
                var kv = pair.split('=');
                params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
            });
        }

        return { page: page, params: params };
    }

    function markActive(page) {
        $$('.nav-item, .bottom-nav a').forEach(function (a) {
            var target = a.dataset.page;
            var isActive = target === page;
            a.classList.toggle('active', isActive);
            if (isActive) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    function route() {
        var r = parsePath();
        var page = r.page;
        var main = $('#main');
        if (!Pages[page]) {
            markActive('');
            main.innerHTML = '<div class="panel" style="text-align:center; padding: 60px 20px; max-width: 600px; margin: 40px auto; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow);">' +
                '<h1 style="font-size: 6rem; color: var(--gold); margin: 0 0 16px; line-height: 1; font-family: var(--serif); font-weight: 800;">404</h1>' +
                '<h2 style="margin-top: 0; font-size: 1.5rem;">Page not found</h2>' +
                '<p class="fine" style="margin-bottom: 24px; font-size: 1rem; line-height: 1.6;">The page you are looking for does not exist, has been moved, or is temporarily unavailable.</p>' +
                '<div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">' +
                '<button class="btn" onclick="history.back()">← Go Back</button>' +
                '<a class="btn btn-primary" href="/dashboard">Go to Overview</a>' +
                '<a class="btn" href="/ai-tutor">Ask Sanjana AI</a>' +
                '</div>' +
                '</div>';
            document.body.classList.remove('nav-open');
            return;
        }
        markActive(page);
        document.title = (PAGE_TITLES[page] || 'SanjanaIAS') + ' · SanjanaIAS';
        window.scrollTo(0, 0);
        document.body.classList.remove('nav-open');
        try {
            Pages[page](main, r.params);
            // Force animation re-trigger
            main.style.animation = 'none';
            main.offsetHeight; /* trigger reflow */
            main.style.animation = null;
        }
        catch (err) {
            console.error('[SanjanaIAS] page error:', err);
            main.innerHTML = '<div class="panel"><h1>Something went wrong</h1><p class="fine">' + esc(String(err && err.message || err)) + '</p>' +
                '<a class="btn" href="/dashboard">Back to dashboard</a></div>';
        }
    }

    function wireShell() {
        /* Smart Header (Hide on scroll down, show on scroll up) */
        var lastScrollTop = 0;
        var header = $('.site-header');
        window.addEventListener('scroll', function () {
            if (window.innerWidth > 900) return; // Fix: only hide on mobile
            var st = window.pageYOffset || document.documentElement.scrollTop;
            if (st > lastScrollTop && st > 60) {
                header.classList.add('hide-header'); // scrolling down
            } else {
                header.classList.remove('hide-header'); // scrolling up
            }
            lastScrollTop = st <= 0 ? 0 : st;
        }, false);

        /* Theme toggle */
        $('#themeToggle').addEventListener('click', function () {
            var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('sanjana.theme', next); } catch (e) { }
        });

        /* Mobile nav toggle */
        $('#navToggle').addEventListener('click', function () {
            document.body.classList.toggle('nav-open');
            var isOpen = document.body.classList.contains('nav-open');
            this.setAttribute('aria-expanded', isOpen);
            this.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
        });
        $('#sidebar').addEventListener('click', function (e) {
            if (e.target.closest('a')) document.body.classList.remove('nav-open');
        });
        document.addEventListener('click', function (e) {
            if (document.body.classList.contains('nav-open') &&
                !e.target.closest('#sidebar') &&
                !e.target.closest('#navToggle')) {
                document.body.classList.remove('nav-open');
            }
        });

        /* Search overlay */
        var overlay = $('#overlay');
        var input = $('#overlayInput');
        var results = $('#overlayResults');
        var region = '';

        function renderResults() {
            var q = input.value.trim();
            if (!q) { results.innerHTML = '<p class="res-empty">Start typing to search the SanjanaIAS library.</p>'; return; }
            var hits = SI_SEARCH.query(q, { region: region, limit: 12 });
            results.innerHTML = hits.length ? hits.map(function (h) {
                return '<a class="res-item" href="/article/' + encodeURIComponent(h.topic.id) + '">' +
                    '<strong>' + esc(h.topic.title) + '</strong>' +
                    '<span>' + esc(regionLabel(h.topic.region)) + ' · ' + esc(h.topic.category) + ' · ' + (h.topic.gsPapers || []).join(', ') + '</span></a>';
            }).join('') : '<p class="res-empty">No match in the collected library yet. Try a broader term.</p>';
        }
        function openSearch() { overlay.classList.add('open'); setTimeout(function () { input.focus(); }, 30); renderResults(); }
        function closeSearch() { overlay.classList.remove('open'); }

        $('#searchTrigger').addEventListener('click', openSearch);
        $('#overlayClose').addEventListener('click', closeSearch);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSearch(); });
        input.addEventListener('input', renderResults);
        $('#overlayFilters').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            region = b.dataset.region;
            $$('#overlayFilters button').forEach(function (x) { x.classList.toggle('active', x === b); });
            renderResults();
        });
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
            if (e.key === 'Escape') {
                closeSearch();
                document.body.classList.remove('nav-open');
                document.getElementById('authModal').classList.remove('open');
            }
        });
        results.addEventListener('click', function (e) {
            if (e.target.closest('a')) closeSearch();
        });

        /* Bookmark delegation */
        document.addEventListener('click', function (e) {
            var b = e.target.closest('[data-bm]');
            if (!b) return;
            e.preventDefault();
            if (!SI_AUTH.user) {
                _requireLogin('bookmark');
                return;
            }
            var on = SI_STORE.toggleBookmark(b.dataset.bm);
            b.classList.toggle('on', on);
            b.textContent = on ? '★' : '☆';
            toast(on ? 'Saved to My Library.' : 'Removed from My Library.');
        });

        /* Smooth-scroll delegation for the article TOC */
        document.addEventListener('click', function (e) {
            var a = e.target.closest('[data-scroll-to]');
            if (!a) return;
            e.preventDefault();
            var el = document.getElementById(a.dataset.scrollTo);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    async function loadFeed() {
        /* 1. Supabase (preferred when configured) */
        if (supabaseClient) {
            try {
                var cutoff = getWeekAgoLocal();
                var sb = await supabaseClient
                    .from('topics')
                    .select('*')
                    .or('published.gte.' + cutoff + ',curated.eq.true')
                    .order('published', { ascending: false });
                if (!sb.error && Array.isArray(sb.data) && sb.data.length) {
                    State.news = {
                        updated: new Date().toISOString(),
                        topics: sb.data.map(function (row) {
                            return {
                                id: row.slug || row.id,
                                title: row.title,
                                region: row.region,
                                regions: row.regions || [row.region],
                                category: row.category,
                                tags: row.tags || [],
                                gsPapers: row.gs_papers || [],
                                summary: row.summary,
                                whyItMatters: row.why_it_matters,
                                image: row.image,
                                imageCredit: row.image_credit,
                                readTime: row.read_time || 5,
                                published: row.published,
                                updated: row.updated,
                                importance: row.importance || 0,
                                importanceReason: row.importance_reason,
                                curated: !!row.curated,
                                sources: row.sources || [],
                                sections: row.sections || {}
                            };
                        })
                    };
                    return;
                }
            } catch (e) {
                /* fall through to JSON / seed */
            }
        }

        /* 2. Static JSON (written by the collector) */
        try {
            var res = await fetch('data/news.json', { cache: 'no-store' });
            if (res.ok) {
                var json = await res.json();
                if (json && Array.isArray(json.topics) && json.topics.length) {
                    var c7 = getWeekAgoLocal();
                    json.topics = json.topics.filter(function (t) {
                        return t.curated || (t.published || '').slice(0, 10) >= c7;
                    });
                    State.news = json;
                    return;
                }
            }
        } catch (e) {
            /* file:// or offline — fall back to seed */
        }

        /* 3. Seed */
        State.news = SEED_NEWS;
    }

    async function boot() {
        wireShell();
        wireAuthUI();
        await loadFeed();
        await SI_AUTH.init();
        await _loadUserData();
        SI_AUTH.onChange(async function () {
            await _loadUserData();
            route();
        });
        var upd = $('#lastUpdated');
        if (upd && State.news.updated) upd.textContent = 'Updated ' + fmtRelative(State.news.updated);
        if (SI_AUTH.user) SI_STORE.touchDay();
        route();
        window.addEventListener('hashchange', route);
        document.dispatchEvent(new CustomEvent('si:ready'));
    }

    function wireAuthUI() {
        var modal = document.getElementById('authModal');
        var body = document.getElementById('authBody');
        var btn = document.getElementById('authBtn');
        var closeBtn = document.getElementById('authClose');
        if (!modal || !btn) return;

        function open(msg) {
            if (SI_AUTH.user) renderAccount();
            else {
                renderLogin();
                if (msg) {
                    var err = document.getElementById('auError');
                    if (err) err.textContent = msg;
                }
            }
            modal.classList.add('open');
            setTimeout(function () {
                var first = body.querySelector('input, select, textarea');
                if (first) first.focus();
            }, 50);
        }
        function close() { modal.classList.remove('open'); }

        window._openAuthModal = open;
        btn.addEventListener('click', open);
        closeBtn.addEventListener('click', close);
        modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

        // Trap focus inside the modal
        modal.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab') return;
            var focusable = body.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            var first = focusable[0];
            var last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });

        function renderLogin() {
            body.innerHTML =
                '<form id="loginForm">' +
                '<div style="text-align:center; margin-bottom: 16px;">' +
                '<img src="/logo.png" alt="Logo" width="48" height="48" style="border-radius: 12px; margin: 0 auto;">' +
                '</div>' +
                '<h2>Log in</h2>' +
                '<label for="auUsername">Username</label><input id="auUsername" type="text" autocomplete="username" required>' +
                '<label for="auPassword">Password</label><input id="auPassword" type="password" autocomplete="current-password" required>' +
                '<p class="auth-error" id="auError"></p>' +
                '<button class="btn btn-primary block" type="submit">Log in</button>' +
                '</form>' +
                '<a class="auth-link" id="auToSignup">Create an account</a>' +
                '<a class="auth-link" id="auToForgot">Forgot password?</a>';

            document.getElementById('loginForm').addEventListener('submit', async function (e) {
                e.preventDefault();
                var u = document.getElementById('auUsername').value.trim();
                var p = document.getElementById('auPassword').value;
                var err = document.getElementById('auError');
                err.textContent = '';
                if (!u || !p) { err.textContent = 'Username or password is incorrect.'; return; }
                var r = await SI_AUTH.signIn(u, p);
                if (r.error) { err.textContent = r.error; return; }
                close();
                toast('Welcome back, ' + u + '.');
            });
            document.getElementById('auToSignup').addEventListener('click', renderSignup);
            document.getElementById('auToForgot').addEventListener('click', renderForgot);
        }

        function renderSignup() {
            body.innerHTML =
                '<form id="signupForm">' +
                '<div style="text-align:center; margin-bottom: 16px;">' +
                '<img src="/logo.png" alt="Logo" width="48" height="48" style="border-radius: 12px; margin: 0 auto;">' +
                '</div>' +
                '<h2>Create account</h2>' +
                '<label for="auUsername">Username</label><input id="auUsername" type="text" autocomplete="username" placeholder="3–24 letters, numbers, underscores">' +
                '<label for="auPassword">Password</label><input id="auPassword" type="password" autocomplete="new-password" placeholder="At least 8 characters">' +
                '<label for="auSQ">Security question</label>' +
                '<select id="auSQ">' +
                '<option>What is your mother\'s maiden name?</option>' +
                '<option>What was the name of your first pet?</option>' +
                '<option>What city were you born in?</option>' +
                '<option>What is your favourite book?</option>' +
                '<option>What was your first school?</option>' +
                '</select>' +
                '<label for="auSA">Security answer</label><input id="auSA" type="text" autocomplete="off">' +
                '<p class="auth-error" id="auError"></p>' +
                '<button class="btn btn-primary block" type="submit">Create account</button>' +
                '</form>' +
                '<a class="auth-link" id="auToLogin">Already have an account? Log in</a>';

            document.getElementById('signupForm').addEventListener('submit', async function (e) {
                e.preventDefault();
                var u = document.getElementById('auUsername').value.trim();
                var p = document.getElementById('auPassword').value;
                var sq = document.getElementById('auSQ').value;
                var sa = document.getElementById('auSA').value.trim();
                var err = document.getElementById('auError');
                err.textContent = '';
                var r = await SI_AUTH.signUp(u, p, sq, sa);
                if (r.error) { err.textContent = r.error; return; }
                close();
                toast('Account created. You are logged in.');
            });
            document.getElementById('auToLogin').addEventListener('click', renderLogin);
        }

        function renderForgot() {
            body.innerHTML =
                '<h2>Reset password</h2>' +
                '<label for="auUsername">Username</label><input id="auUsername" type="text" autocomplete="username">' +
                '<button class="btn block" id="auLookup" type="button">Next</button>' +
                '<p class="auth-error" id="auError"></p>' +
                '<a class="auth-link" id="auToLogin">Back to login</a>';
            document.getElementById('auToLogin').addEventListener('click', renderLogin);
            document.getElementById('auLookup').addEventListener('click', async function () {
                var u = document.getElementById('auUsername').value.trim();
                var err = document.getElementById('auError');
                err.textContent = '';
                if (!u) { err.textContent = 'Enter your username.'; return; }
                var sq = await SI_AUTH.getSecurityQuestion(u);
                if (!sq) { err.textContent = 'No account found.'; return; }
                renderAnswerStep(u, sq);
            });
        }

        function renderAnswerStep(username, question) {
            body.innerHTML =
                '<h2>Reset password</h2>' +
                '<p class="auth-user">Username: <strong>' + esc(username) + '</strong></p>' +
                '<label for="auSA">' + esc(question) + '</label><input id="auSA" type="text" autocomplete="off">' +
                '<label for="auNewPass">New password</label><input id="auNewPass" type="password" autocomplete="new-password" placeholder="At least 8 characters">' +
                '<p class="auth-error" id="auError"></p>' +
                '<button class="btn btn-primary block" id="auReset" type="button">Reset password</button>' +
                '<a class="auth-link" id="auToLogin">Back to login</a>';
            document.getElementById('auToLogin').addEventListener('click', renderLogin);
            document.getElementById('auReset').addEventListener('click', async function () {
                var sa = document.getElementById('auSA').value.trim();
                var np = document.getElementById('auNewPass').value;
                var err = document.getElementById('auError');
                err.textContent = '';
                var r = await SI_AUTH.resetPassword(username, sa, np);
                if (r.error) { err.textContent = r.error; return; }
                toast('Password reset. You can log in now.');
                renderLogin();
            });
        }

        function renderAccount() {
            var u = SI_AUTH.username();
            body.innerHTML =
                '<h2>Your account</h2>' +
                '<p class="auth-user">Logged in as <strong>' + esc(u) + '</strong></p>' +
                '<button class="btn danger block" id="auLogout" type="button">Log out</button>' +
                '<button class="btn block" id="auErase" type="button" style="margin-top:8px">Erase all my data</button>';
            document.getElementById('auLogout').addEventListener('click', async function () {
                await SI_AUTH.signOut();
                _mem = { bookmarks: [], read: {}, notes: {}, missed: {}, mains: {}, quiz: { attempts: [], best: 0 }, days: [] };
                close(); route(); toast('Logged out.');
            });
            document.getElementById('auErase').addEventListener('click', async function () {
                if (!confirm('Erase bookmarks, notes, drafts, revision and progress?')) return;
                await SI_STORE.reset();
                close(); route(); toast('All your data erased.');
            });
        }
    }

    if (typeof document !== 'undefined') {
        // Intercept link clicks for SPA routing
        document.addEventListener('click', function (e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; // Fix ctrl-click

            var link = e.target.closest('a');
            if (!link) return;
            var href = link.getAttribute('href');
            if (!href) return;

            if (href.indexOf('http') === 0 ||
                href.endsWith('.html') ||
                href.startsWith('#') ||
                link.classList.contains('skip') ||
                link.target === '_blank') {
                return;
            }

            e.preventDefault();
            window.history.pushState({}, '', href);
            route(); // Re-render the page
        });

        window.addEventListener('popstate', route);

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }

    /* ============================================================
       12. Exports
       ============================================================ */
    var exported = {
        SI_RSS: SI_RSS,
        SI_CLASSIFY: SI_CLASSIFY,
        SI_DEDUPE: SI_DEDUPE,
        SI_RELEVANCE: SI_RELEVANCE,
        SI_STORE: SI_STORE,
        SI_SEARCH: SI_SEARCH,
        SI_ARTICLE: SI_ARTICLE,
        SI_TUTOR: SI_TUTOR,
        SI_REVISION: SI_REVISION,
        SEED_NEWS: SEED_NEWS,
        SEED_SOURCES: SEED_SOURCES,
        SEED_SYLLABUS: SEED_SYLLABUS,
        SEED_QUESTIONS: SEED_QUESTIONS,
        ILLUSTRATIONS: ILLUSTRATIONS,
        State: State
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = exported;
    } else {
        Object.keys(exported).forEach(function (k) { root[k] = exported[k]; });
    }
})(typeof self !== 'undefined' ? self : globalThis);