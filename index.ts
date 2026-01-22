import * as dotenv from 'dotenv'

dotenv.config()

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {z} from 'zod'

const LOGSEQ_TOKEN = process.env.LOGSEQ_TOKEN

const LOGSEQ_HOST = process.env.LOGSEQ_HOST ?? '127.0.0.1'
const LOGSEQ_PORT = process.env.LOGSEQ_PORT ?? '12315'
const LOGSEQ_API_URL = process.env.LOGSEQ_API_URL ?? `http://${LOGSEQ_HOST}:${LOGSEQ_PORT}/api`

const server = new McpServer({
    name: 'Logseq Tools',
    version: '1.0.0',
})

// Regular expression to find Logseq page links like [[page name]]
const PAGE_LINK_REGEX = /\[\[(.*?)\]\]/g

// Format a date as a string in the format that Logseq journal pages use
function formatJournalDate(date: Date): string {
    const month = date.toLocaleString('en-US', {month: 'short'}).toLowerCase()
    const day = date.getDate()
    const year = date.getFullYear()
    return `${month} ${day}${getDaySuffix(day)}, ${year}`
}

// Get the appropriate suffix for a day number (1st, 2nd, 3rd, etc.)
function getDaySuffix(day: number): string {
    if (day >= 11 && day <= 13) return 'th'

    switch (day % 10) {
        case 1:
            return 'st'
        case 2:
            return 'nd'
        case 3:
            return 'rd'
        default:
            return 'th'
    }
}

// Helper function to make API calls to Logseq
async function callLogseqApi(method: string, args: any[] = []): Promise<any> {
    const response = await fetch(LOGSEQ_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${LOGSEQ_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            method,
            args,
        }),
    })

    if (!response.ok) {
        throw new Error(
            `Logseq API error: ${response.status} ${response.statusText}`
        )
    }

    return response.json()
}

// Helper function to add content to a page by creating blocks
async function addContentToPage(
    pageName: string,
    content: string
): Promise<void> {
    try {
        // First get the page to ensure it exists
        const page = await callLogseqApi('logseq.Editor.getPage', [pageName])

        if (!page) {
            throw new Error(`Page ${pageName} does not exist`)
        }

        // Get the page's blocks
        const blocks = await callLogseqApi('logseq.Editor.getPageBlocksTree', [
            pageName,
        ])

        // If the page is empty, create initial block
        if (!blocks || blocks.length === 0) {
            await callLogseqApi('logseq.Editor.appendBlockInPage', [
                pageName,
                content,
            ])
            return
        }

        // If the page already has content, append to it
        // For more complex content structures, we might need to parse the content
        // and add blocks one by one with proper hierarchy
        const contentLines = content
            .split('\n')
            .filter((line) => line.trim() !== '')

        for (const line of contentLines) {
            await callLogseqApi('logseq.Editor.appendBlockInPage', [pageName, line])
        }
    } catch (error) {
        console.error(`Error adding content to page ${pageName}:`, error)
        throw error
    }
}

// Check if a string represents a journal page date
function isJournalDate(pageName: string): boolean {
    // Journal pages typically have formats like "Mar 14th, 2025"
    // This regex matches common journal date formats
    const journalDateRegex =
        /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(st|nd|rd|th)?,\s+\d{4}$/i
    return journalDateRegex.test(pageName)
}

// Parse text content into a blocks structure for journal pages
function parseContentToBlocks(content: string): Array<{ content: string }> {
    const lines = content.split('\n').filter((line) => line.trim() !== '')
    const blocks: Array<{ content: string }> = []

    for (const line of lines) {
        // Skip heading lines (usually the date)
        if (line.startsWith('#') || line.trim() === '') continue

        // Create a block for each line
        blocks.push({
            content: line,
        })
    }

    return blocks
}

// Helper function to convert Date to Logseq journalDay format (YYYYMMDD)
function dateToJournalDay(date: Date): number {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return parseInt(`${year}${month}${day}`)
}

// Helper function to convert Logseq journalDay format (YYYYMMDD) to Date
function journalDayToDate(journalDay: number): Date | null {
    const str = journalDay.toString()

    // Validate that the input has exactly 8 digits
    if (str.length !== 8 || !/^\d{8}$/.test(str)) {
        console.warn(`Invalid journalDay format: ${journalDay}. Expected format: YYYYMMDD (8 digits)`)
        return null
    }

    const year = parseInt(str.substring(0, 4))
    const month = parseInt(str.substring(4, 6)) - 1 // Month is 0-indexed
    const day = parseInt(str.substring(6, 8))
    return new Date(year, month, day)
}

// Helper function to parse date range from natural language
function parseDateRange(dateRange: string): {
    start: Date
    end: Date
    title: string
} {
    const today = new Date()
    const end = new Date(today)
    end.setHours(23, 59, 59, 999) // End of today
    let start = new Date(today)
    let title = ''

    const normalizedRange = dateRange.toLowerCase().trim()

    switch (normalizedRange) {
        case 'today':
            start.setHours(0, 0, 0, 0) // Start of today
            title = "Today's Journal Summary"
            break
        case 'yesterday':
            start.setDate(today.getDate() - 1)
            start.setHours(0, 0, 0, 0)
            end.setDate(today.getDate() - 1)
            title = "Yesterday's Journal Summary"
            break
        case 'this week':
            start.setDate(today.getDate() - today.getDay()) // Start of week (Sunday)
            start.setHours(0, 0, 0, 0)
            title = 'Weekly Journal Summary'
            break
        case 'last week':
            start.setDate(today.getDate() - today.getDay() - 7) // Start of last week
            start.setHours(0, 0, 0, 0)
            end.setDate(today.getDate() - today.getDay() - 1)
            end.setHours(23, 59, 59, 999)
            title = "Last Week's Journal Summary"
            break
        case 'this month':
            start.setDate(1) // Start of current month
            start.setHours(0, 0, 0, 0)
            title = `Journal Summary for ${today.toLocaleString('en-US', {
                month: 'long',
            })} ${today.getFullYear()}`
            break
        case 'last month':
            start.setMonth(today.getMonth() - 1, 1) // Start of last month
            start.setHours(0, 0, 0, 0)
            end.setDate(0) // Last day of previous month
            title = `Journal Summary for ${start.toLocaleString('en-US', {
                month: 'long',
            })} ${start.getFullYear()}`
            break
        case 'this year':
            start.setMonth(0, 1) // January 1st
            start.setHours(0, 0, 0, 0)
            title = `Journal Summary for ${today.getFullYear()}`
            break
        case 'last year':
            start.setFullYear(today.getFullYear() - 1, 0, 1) // January 1st of last year
            start.setHours(0, 0, 0, 0)
            end.setFullYear(today.getFullYear() - 1, 11, 31) // December 31st of last year
            end.setHours(23, 59, 59, 999)
            title = `Journal Summary for ${today.getFullYear() - 1}`
            break
        case 'year to date':
            start.setMonth(0, 1) // January 1st of current year
            start.setHours(0, 0, 0, 0)
            title = `Year-to-Date Journal Summary for ${today.getFullYear()}`
            break
        default:
            // Default to current week if input doesn't match any pattern
            start.setDate(today.getDate() - today.getDay()) // Start of week (Sunday)
            start.setHours(0, 0, 0, 0)
            title = 'Weekly Journal Summary'
    }

    return {start, end, title}
}

server.tool('getAllPages', async () => {
    try {
        const pages = await callLogseqApi('logseq.Editor.getAllPages')

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(pages),
                },
            ],
        }
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error fetching Logseq pages: ${error.message}`,
                },
            ],
        }
    }
})

// Get content for a specific page by name or UUID
async function getPageContent(pageNameOrUuid: string) {
    try {
        return await callLogseqApi('logseq.Editor.getPageBlocksTree', [
            pageNameOrUuid,
        ])
    } catch (error) {
        console.error(`Error fetching page content: ${error.message}`)
        return null
    }
}

// Get a page's content and extract linked pages
server.tool(
    'getPage',
    {
        pageName: z.string().describe('Name of the Logseq page to retrieve'),
    },
    async ({pageName}) => {
        try {
            const content = await getPageContent(pageName)

            if (!content) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Page "${pageName}" not found or has no content.`,
                        },
                    ],
                }
            }

            // Format the page content
            let formattedContent = `# ${pageName}\n\n`

            // Process blocks to extract text and maintain hierarchy
            const processBlocks = (blocks: any[], indent = 0) => {
                let text = ''
                for (const block of blocks) {
                    if (block.content) {
                        const indentation = '  '.repeat(indent)
                        text += `${indentation}- ${block.content}\n`

                        if (block.children && block.children.length > 0) {
                            text += processBlocks(block.children, indent + 1)
                        }
                    }
                }
                return text
            }

            formattedContent += processBlocks(content)

            // --- Fetch and add backlinks ---
            const backlinks = await findBacklinks(pageName)
            if (backlinks.length > 0) {
                formattedContent += `\n\n## Backlinks\n\n`
                backlinks.forEach((backlinkPageName) => {
                    formattedContent += `- [[${backlinkPageName}]]\n`
                })
            } else {
                formattedContent += '\n\n## Backlinks\n\nNo backlinks found.\n'
            }
            // --- End backlinks ---

            return {
                content: [
                    {
                        type: 'text',
                        text: formattedContent,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error retrieving page content: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Extract and fetch linked pages from content
async function extractLinkedPages(content: string): Promise<{
    pages: Record<string, string>
    occurrences: Record<string, number>
}> {
    const linkedPages: Record<string, string> = {}
    const occurrences: Record<string, number> = {}
    const matches = [...content.matchAll(PAGE_LINK_REGEX)]

    for (const match of matches) {
        const pageName = match[1].trim()
        // Count occurrences of each page
        occurrences[pageName] = (occurrences[pageName] || 0) + 1

        if (!linkedPages[pageName]) {
            const pageContent = await getPageContent(pageName)
            if (pageContent) {
                // Process blocks to extract text and maintain hierarchy
                const processBlocks = (blocks: any[], indent = 0) => {
                    let text = ''
                    for (const block of blocks) {
                        if (block.content) {
                            const indentation = '  '.repeat(indent)
                            text += `${indentation}- ${block.content}\n`

                            if (block.children && block.children.length > 0) {
                                text += processBlocks(block.children, indent + 1)
                            }
                        }
                    }
                    return text
                }

                linkedPages[pageName] = processBlocks(pageContent)
            }
        }
    }

    return {pages: linkedPages, occurrences}
}

// Get summary of journal entries for a flexible date range
server.tool(
    'getJournalSummary',
    {
        dateRange: z
            .string()
            .describe(
                'Date range like "today", "this week", "last month", "this year", "year to date", etc.'
            ),
    },
    async ({dateRange}) => {
        try {
            // Get all pages
            const pages = await callLogseqApi('logseq.Editor.getAllPages')

            // Parse the date range
            const {start, end, title} = parseDateRange(dateRange)

            // Convert start and end dates to journalDay format for comparison
            const startJournalDay = dateToJournalDay(start)
            const endJournalDay = dateToJournalDay(end)

            // Filter for journal pages within the date range
            const journalPages = pages.filter((page: any) => {
                return (
                    page['journal?'] === true &&
                    typeof page.journalDay === 'number' &&
                    page.journalDay >= startJournalDay &&
                    page.journalDay <= endJournalDay
                )
            })

            // Sort by date
            journalPages.sort((a: any, b: any) => a.journalDay - b.journalDay)

            // For each journal page, get its content
            const journalContents: Array<{ date: string; content: any }> = []
            for (const page of journalPages) {
                const content = await getPageContent(page.name)
                if (content) {
                    journalContents.push({
                        date: page.originalName,
                        content: content,
                    })
                }
            }

            // Format the summary
            let summary = `# ${title}\n\n`
            summary += `*Date range: ${start.toLocaleDateString()} to ${end.toLocaleDateString()}*\n\n`

            if (journalContents.length === 0) {
                summary += `No journal entries found for ${dateRange}.`
            } else {
                // Track all linked pages across all entries
                const allLinkedPages: Record<string, string> = {}
                const allPageOccurrences: Record<string, number> = {}

                for (const entry of journalContents) {
                    summary += `## ${entry.date}\n\n`

                    // Process blocks to extract text and maintain hierarchy
                    const processBlocks = (blocks: any[], indent = 0) => {
                        let text = ''
                        for (const block of blocks) {
                            if (block.content) {
                                const indentation = '  '.repeat(indent)
                                text += `${indentation}- ${block.content}\n`

                                if (block.children && block.children.length > 0) {
                                    text += processBlocks(block.children, indent + 1)
                                }
                            }
                        }
                        return text
                    }

                    const entryText = processBlocks(entry.content)
                    summary += entryText
                    summary += '\n'

                    // Extract linked pages from this entry
                    const {pages: linkedPages, occurrences} = await extractLinkedPages(
                        entryText
                    )

                    // Merge the linked pages
                    Object.assign(allLinkedPages, linkedPages)

                    // Merge occurrences counts
                    for (const [pageName, count] of Object.entries(occurrences)) {
                        allPageOccurrences[pageName] =
                            (allPageOccurrences[pageName] || 0) + count
                    }
                }

                // Add top concepts section (most frequently referenced pages)
                if (Object.keys(allPageOccurrences).length > 0) {
                    // Sort pages by occurrence count (most frequent first)
                    const sortedPages = Object.entries(allPageOccurrences).sort(
                        (a, b) => b[1] - a[1]
                    )

                    // Add a "Top Concepts" section if we have any pages
                    if (sortedPages.length > 0) {
                        summary += `\n## Top Concepts\n\n`
                        for (const [pageName, count] of sortedPages.slice(0, 10)) {
                            summary += `- [[${pageName}]] (${count} references)\n`
                        }
                        summary += '\n'
                    }

                    // Add detailed referenced pages section
                    summary += `\n## Referenced Pages\n\n`
                    for (const [pageName, content] of Object.entries(allLinkedPages)) {
                        const occurrenceCount = allPageOccurrences[pageName]
                        summary += `### ${pageName}\n\n`
                        if (occurrenceCount > 1) {
                            summary += `*Referenced ${occurrenceCount} times*\n\n`
                        }
                        summary += `${content}\n\n`
                    }
                }
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: summary,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error generating journal summary: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Additional tools: createPage, searchPages, and getBacklinks

server.tool(
    'createPage',
    {
        pageName: z.string().describe('Name for the new Logseq page'),
        content: z
            .string()
            .optional()
            .describe('Initial content for the page (optional)'),
    },
    async ({pageName, content}) => {
        try {
            // Check if this is a journal page
            const isJournal = isJournalDate(pageName)

            // For journal pages, we need special handling
            if (isJournal) {
                try {
                    // First, try to get the page to see if it exists
                    const existingPage = await callLogseqApi('logseq.Editor.getPage', [
                        pageName,
                    ])

                    if (existingPage) {
                        // If the page exists and we have content, append to it
                        if (content) {
                            // For journal pages, we need to properly parse the content into blocks
                            // This will depend on the format of your content
                            // For now, we'll use a simple append approach
                            await addContentToPage(pageName, content)
                        }

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Journal page "${pageName}" updated successfully.`,
                                },
                            ],
                        }
                    }
                } catch (e) {
                    // Page doesn't exist, we'll create it below
                    console.log(`Journal page ${pageName} doesn't exist yet, creating...`)
                }

                // Create the journal page
                // Set journal? property to true to make it a proper journal page
                await callLogseqApi('logseq.Editor.createPage', [
                    pageName,
                    {'journal?': true},
                ])

                // If we have content, add it to the new page
                if (content) {
                    await addContentToPage(pageName, content)
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Journal page "${pageName}" successfully created.`,
                        },
                    ],
                }
            } else {
                // Regular page creation
                await callLogseqApi('logseq.Editor.createPage', [pageName, {}])

                // If we have content, add it to the new page
                if (content) {
                    await addContentToPage(pageName, content)
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Page "${pageName}" successfully created.`,
                        },
                    ],
                }
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error creating page "${pageName}": ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'searchPages',
    {
        query: z.string().describe('Search query to filter pages by name'),
    },
    async ({query}) => {
        try {
            const pages = await callLogseqApi('logseq.Editor.getAllPages')
            const matched = pages.filter(
                (page: any) =>
                    page.name && page.name.toLowerCase().includes(query.toLowerCase())
            )
            if (matched.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `No pages matching query "${query}" found.`,
                        },
                    ],
                }
            }
            let text = `Pages matching "${query}":\n`
            matched.forEach((page: any) => {
                text += `- ${page.name}\n`
            })
            return {
                content: [
                    {
                        type: 'text',
                        text,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error searching pages: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Helper function to get backlinks for a page
async function findBacklinks(pageName: string): Promise<string[]> {
    const pages = await callLogseqApi('logseq.Editor.getAllPages')
    const backlinkPages: string[] = []

    // Helper function to process blocks into text
    function processBlocks(blocks: any[], indent = 0): string {
        let text = ''
        for (const block of blocks) {
            if (block.content) {
                text += `${'  '.repeat(indent)}${block.content}\n`
                if (block.children && block.children.length > 0) {
                    text += processBlocks(block.children, indent + 1)
                }
            }
        }
        return text
    }

    for (const page of pages) {
        // Skip the page itself and pages without names
        if (!page.name || page.name === pageName) continue

        const content = await getPageContent(page.name)
        if (!content) continue

        const contentText = processBlocks(content)
        const linkRegex = new RegExp(`\[\[\\s*${pageName}\\s*\]\]`, 'i') // Case-insensitive matching

        if (linkRegex.test(contentText)) {
            backlinkPages.push(page.name)
        }
    }

    return backlinkPages
}

server.tool(
    'getBacklinks',
    {
        pageName: z.string().describe('The page name for which to find backlinks'),
    },
    async ({pageName}) => {
        try {
            const backlinkPages = await findBacklinks(pageName) // Use the helper function

            if (backlinkPages.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `No backlinks found for page "${pageName}".`,
                        },
                    ],
                }
            }

            let resultText = `Pages referencing "${pageName}":\n`
            backlinkPages.forEach((name) => {
                resultText += `- [[${name}]]\n` // Use Logseq link format
            })
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching backlinks: ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'addJournalEntry',
    {
        content: z
            .string()
            .describe("Content to add to today's journal or a specified date"),
        date: z
            .string()
            .optional()
            .describe(
                'Optional date format (e.g., "mar 14th, 2025"). Defaults to today'
            ),
        asBlock: z
            .boolean()
            .optional()
            .describe('Whether to add as a single block (default: true)'),
    },
    async ({content, date, asBlock = true}) => {
        try {
            // Determine the journal page name (today or specific date)
            let pageName = date || formatJournalDate(new Date())

            // Check if this page exists and is a journal page
            let pageExists = false
            try {
                const existingPage = await callLogseqApi('logseq.Editor.getPage', [
                    pageName,
                ])
                pageExists = !!existingPage
            } catch (e) {
                // Page doesn't exist, we'll create it
                console.log(`Journal page ${pageName} doesn't exist yet, creating...`)
            }

            // If page doesn't exist, create it first
            if (!pageExists) {
                await callLogseqApi('logseq.Editor.createPage', [
                    pageName,
                    {'journal?': true},
                ])
            }

            // Clean up content if needed
            let cleanContent = content

            // If we're adding as a single block and content has multiple lines,
            // we need to preserve the content exactly as is without any processing
            if (asBlock) {
                // Remove any leading/trailing whitespace
                cleanContent = content.trim()

                // Remove the title/heading if it's the same as the page name (to avoid duplication)
                const titleRegex = new RegExp(`^#\\s+${pageName}\\s*$`, 'im')
                cleanContent = cleanContent.replace(titleRegex, '').trim()

                // Add the content as a single block
                await callLogseqApi('logseq.Editor.appendBlockInPage', [
                    pageName,
                    cleanContent,
                ])

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Added journal entry to "${pageName}" as a single block.`,
                        },
                    ],
                }
            } else {
                // For multi-block approach, use the pre-existing function (though not recommended)
                await addContentToPage(pageName, cleanContent)

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Added journal entry to "${pageName}" as multiple blocks.`,
                        },
                    ],
                }
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error adding journal entry: ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'analyzeGraph',
    {
        daysThreshold: z
            .number()
            .optional()
            .describe(
                'Number of days to look back for "recent" content (default: 30)'
            ),
    },
    async ({daysThreshold = 30}) => {
        try {
            const pages = await callLogseqApi('logseq.Editor.getAllPages')

            // Initialize our analysis containers
            const todos: Array<{ page: string; task: string }> = []
            const frequentReferences: Array<{
                page: string
                count: number
                lastUpdate: Date | null
            }> = []
            const recentUpdates: Array<{ page: string; date: Date }> = []
            const pageConnections: Record<string, Set<string>> = {}

            // Track reference counts and last updates
            const referenceCount: Record<string, number> = {}
            const lastUpdateDates: Record<string, Date | null> = {}

            // Process each page
            for (const page of pages) {
                if (!page.name) continue

                const content = await getPageContent(page.name)
                if (!content) continue

                // Helper function to process blocks recursively
                const processBlocks = (blocks: any[]) => {
                    for (const block of blocks) {
                        if (!block.content) continue

                        // Look for TODO items
                        if (
                            block.content.toLowerCase().includes('todo') ||
                            block.content.toLowerCase().includes('later') ||
                            block.content.includes('- [ ]')
                        ) {
                            todos.push({
                                page: page.name,
                                task: block.content.replace(/^[-*] /, '').trim(),
                            })
                        }

                        // Extract page references
                        const matches = [...block.content.matchAll(PAGE_LINK_REGEX)]
                        for (const match of matches) {
                            const linkedPage = match[1].trim()
                            referenceCount[linkedPage] = (referenceCount[linkedPage] || 0) + 1

                            // Track connections between pages
                            if (!pageConnections[page.name]) {
                                pageConnections[page.name] = new Set()
                            }
                            pageConnections[page.name].add(linkedPage)
                        }

                        // Process child blocks
                        if (block.children && block.children.length > 0) {
                            processBlocks(block.children)
                        }
                    }
                }

                processBlocks(content)

                // Track last update date - handle invalid or missing dates
                let updateDate: Date | null = null
                if (page.updatedAt) {
                    const timestamp = new Date(page.updatedAt).getTime()
                    if (!isNaN(timestamp)) {
                        updateDate = new Date(timestamp)
                    }
                }
                lastUpdateDates[page.name] = updateDate

                // Track recent updates only if we have a valid date
                if (updateDate) {
                    const daysSinceUpdate = Math.floor(
                        (Date.now() - updateDate.getTime()) / (1000 * 60 * 60 * 24)
                    )
                    if (daysSinceUpdate <= daysThreshold) {
                        recentUpdates.push({
                            page: page.name,
                            date: updateDate,
                        })
                    }
                }
            }

            // Analyze reference patterns
            for (const [pageName, count] of Object.entries(referenceCount)) {
                if (count > 2) {
                    // Pages referenced more than twice
                    frequentReferences.push({
                        page: pageName,
                        count,
                        lastUpdate: lastUpdateDates[pageName],
                    })
                }
            }

            // Sort by reference count
            frequentReferences.sort((a, b) => b.count - a.count)

            // Find clusters of related pages
            const clusters: Array<string[]> = []
            const processedPages = new Set<string>()

            for (const [pageName, connections] of Object.entries(pageConnections)) {
                if (processedPages.has(pageName)) continue

                const cluster = new Set<string>([pageName])
                const queue = Array.from(connections)

                while (queue.length > 0) {
                    const currentPage = queue.shift()!
                    if (processedPages.has(currentPage)) continue

                    cluster.add(currentPage)
                    processedPages.add(currentPage)

                    // Add connected pages to queue
                    const relatedPages = pageConnections[currentPage]
                    if (relatedPages) {
                        queue.push(...Array.from(relatedPages))
                    }
                }

                if (cluster.size > 2) {
                    // Only include clusters with 3+ pages
                    clusters.push(Array.from(cluster))
                }
            }

            // Generate the insight report
            let report = '# Graph Analysis Insights\n\n'

            // TODO Items Section
            if (todos.length > 0) {
                report += '## Outstanding Tasks\n\n'
                todos.forEach(({page, task}) => {
                    report += `- ${task} *(from [[${page}]])*\n`
                })
                report += '\n'
            }

            // Frequently Referenced Pages
            if (frequentReferences.length > 0) {
                report += '## Frequently Referenced Pages\n\n'
                frequentReferences
                    .slice(0, 10)
                    .forEach(({page, count, lastUpdate}) => {
                        let updateInfo = 'no update date available'
                        if (lastUpdate) {
                            const daysSinceUpdate = Math.floor(
                                (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)
                            )
                            updateInfo = `last updated ${daysSinceUpdate} days ago`
                        }
                        report += `- [[${page}]] (${count} references, ${updateInfo})\n`
                    })
                report += '\n'
            }

            // Recent Updates
            if (recentUpdates.length > 0) {
                report += '## Recent Updates\n\n'
                recentUpdates
                    .sort((a, b) => b.date.getTime() - a.date.getTime())
                    .slice(0, 10)
                    .forEach(({page, date}) => {
                        report += `- [[${page}]] (${date.toLocaleDateString()})\n`
                    })
                report += '\n'
            }

            // Page Clusters
            if (clusters.length > 0) {
                report += '## Related Page Clusters\n\n'
                clusters.slice(0, 5).forEach((cluster, index) => {
                    report += `### Cluster ${index + 1}\n`
                    cluster.forEach((page) => {
                        report += `- [[${page}]]\n`
                    })
                    report += '\n'
                })
            }

            // Potential Action Items
            report += '## Suggested Actions\n\n'

            // Suggest updating frequently referenced but outdated pages
            const outdatedFrequentPages = frequentReferences.filter(
                ({lastUpdate}) =>
                    lastUpdate &&
                    (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24) >
                    daysThreshold
            )

            if (outdatedFrequentPages.length > 0) {
                report += '### Frequently Referenced Pages Needing Updates\n\n'
                outdatedFrequentPages
                    .slice(0, 5)
                    .forEach(({page, count, lastUpdate}) => {
                        if (lastUpdate) {
                            const daysSinceUpdate = Math.floor(
                                (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)
                            )
                            report += `- Consider updating [[${page}]] - referenced ${count} times but last updated ${daysSinceUpdate} days ago\n`
                        }
                    })
                report += '\n'
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: report,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error analyzing graph: ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'findKnowledgeGaps',
    {
        minReferenceCount: z
            .number()
            .optional()
            .describe('Minimum references to consider (default: 3)'),
        includeOrphans: z
            .boolean()
            .optional()
            .describe('Include orphaned pages in analysis (default: true)'),
    },
    async ({minReferenceCount = 3, includeOrphans = true}) => {
        try {
            const pages = await callLogseqApi('logseq.Editor.getAllPages')

            // Track references and their existence
            const references: Record<
                string,
                { count: number; hasPage: boolean; referencedFrom: Set<string> }
            > = {}
            const orphanedPages: string[] = []

            // First pass: collect all pages and initialize their reference tracking
            pages.forEach((page: any) => {
                if (!page.name) return
                references[page.name] = {
                    count: 0,
                    hasPage: true,
                    referencedFrom: new Set(),
                }
            })

            // Second pass: analyze content and collect references
            for (const page of pages) {
                if (!page.name) continue

                const content = await getPageContent(page.name)
                if (!content) continue

                // Process blocks to find references
                const processBlocks = (blocks: any[]) => {
                    for (const block of blocks) {
                        if (!block.content) continue

                        // Find all page references
                        const matches = [...block.content.matchAll(PAGE_LINK_REGEX)]
                        for (const match of matches) {
                            const linkedPage = match[1].trim()

                            // Initialize reference tracking if this is a new reference
                            if (!references[linkedPage]) {
                                references[linkedPage] = {
                                    count: 0,
                                    hasPage: false,
                                    referencedFrom: new Set(),
                                }
                            }

                            references[linkedPage].count++
                            references[linkedPage].referencedFrom.add(page.name)
                        }

                        if (block.children && block.children.length > 0) {
                            processBlocks(block.children)
                        }
                    }
                }

                processBlocks(content)
            }

            // Analyze the data
            const missingPages: Array<{
                name: string
                count: number
                referencedFrom: string[]
            }> = []
            const underdevelopedPages: Array<{
                name: string
                content: string
                referenceCount: number
            }> = []

            for (const [pageName, data] of Object.entries(references)) {
                // Find missing pages (referenced but don't exist)
                if (!data.hasPage && data.count >= minReferenceCount) {
                    missingPages.push({
                        name: pageName,
                        count: data.count,
                        referencedFrom: Array.from(data.referencedFrom),
                    })
                }

                // Find underdeveloped pages (exist but have minimal content)
                if (data.hasPage) {
                    const content = await getPageContent(pageName)
                    if (content) {
                        const contentText = content
                            .map((block: any) => block.content || '')
                            .join(' ')
                        if (contentText.length < 100 && data.count >= minReferenceCount) {
                            // Less than 100 chars is considered minimal
                            underdevelopedPages.push({
                                name: pageName,
                                content: contentText,
                                referenceCount: data.count,
                            })
                        }
                    }

                    // Track orphaned pages
                    if (includeOrphans && data.count === 0) {
                        orphanedPages.push(pageName)
                    }
                }
            }

            // Generate the report
            let report = '# Knowledge Graph Analysis\n\n'

            // Missing Pages Section
            if (missingPages.length > 0) {
                report += '## Missing Pages\n'
                report +=
                    "These topics are frequently referenced but don't have their own pages:\n\n"

                missingPages
                    .sort((a, b) => b.count - a.count)
                    .forEach(({name, count, referencedFrom}) => {
                        report += `### [[${name}]]\n`
                        report += `- Referenced ${count} times\n`
                        report += '- Referenced from:\n'
                        referencedFrom.forEach((source) => {
                            report += `  - [[${source}]]\n`
                        })
                        report += '\n'
                    })
            }

            // Underdeveloped Pages Section
            if (underdevelopedPages.length > 0) {
                report += '## Underdeveloped Pages\n'
                report += 'These pages exist but might need more content:\n\n'

                underdevelopedPages
                    .sort((a, b) => b.referenceCount - a.referenceCount)
                    .forEach(({name, content, referenceCount}) => {
                        report += `### [[${name}]]\n`
                        report += `- Referenced ${referenceCount} times\n`
                        report += `- Current content: "${content.substring(0, 50)}${
                            content.length > 50 ? '...' : ''
                        }"\n\n`
                    })
            }

            // Orphaned Pages Section
            if (includeOrphans && orphanedPages.length > 0) {
                report += '## Orphaned Pages\n'
                report += "These pages aren't referenced by any other pages:\n\n"

                orphanedPages.sort().forEach((page) => {
                    report += `- [[${page}]]\n`
                })
                report += '\n'
            }

            // Add summary statistics
            report += '## Summary Statistics\n\n'
            report += `- Total pages: ${pages.length}\n`
            report += `- Missing pages (referenced ≥${minReferenceCount} times): ${missingPages.length}\n`
            report += `- Underdeveloped pages: ${underdevelopedPages.length}\n`
            if (includeOrphans) {
                report += `- Orphaned pages: ${orphanedPages.length}\n`
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: report,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error analyzing knowledge gaps: ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'analyzeJournalPatterns',
    {
        timeframe: z
            .string()
            .optional()
            .describe('Time period to analyze (e.g., "last 30 days", "this year")'),
        includeMood: z
            .boolean()
            .optional()
            .describe('Analyze mood patterns if present (default: true)'),
        includeTopics: z
            .boolean()
            .optional()
            .describe('Analyze topic patterns (default: true)'),
    },
    async ({
               timeframe = 'last 30 days',
               includeMood = true,
               includeTopics = true,
           }) => {
        try {
            const pages = await callLogseqApi('logseq.Editor.getAllPages')

            // Parse timeframe and get date range
            const now = new Date()
            let startDate = new Date()

            if (timeframe.includes('last')) {
                const [, amount, unit] = timeframe.match(/last (\d+) (\w+)/) || []
                if (amount && unit) {
                    const num = parseInt(amount)
                    switch (unit) {
                        case 'days':
                            startDate.setDate(now.getDate() - num)
                            break
                        case 'weeks':
                            startDate.setDate(now.getDate() - num * 7)
                            break
                        case 'months':
                            startDate.setMonth(now.getMonth() - num)
                            break
                        case 'years':
                            startDate.setFullYear(now.getFullYear() - num)
                            break
                    }
                }
            } else if (timeframe === 'this year') {
                startDate = new Date(now.getFullYear(), 0, 1)
            }

            // Filter journal pages within timeframe
            // Convert start and end dates to journalDay format for comparison
            const startJournalDay = dateToJournalDay(startDate)
            const endJournalDay = dateToJournalDay(now)

            const journalPages = pages.filter((page: any) => {
                if (!page['journal?']) return false
                if (page.journalDay == null) return false
                return page.journalDay >= startJournalDay && page.journalDay <= endJournalDay
            })

            // Sort by date
            journalPages.sort((a: any, b: any) => a.journalDay - b.journalDay)

            // Analysis containers
            const topicFrequency: Record<string, number> = {}
            const topicsByDate: Record<string, Set<string>> = {}
            const moodPatterns: Array<{
                date: string
                mood: string
                context: string
            }> = []
            const habitPatterns: Record<
                string,
                Array<{ date: string; done: boolean }>
            > = {}
            const projectProgress: Record<
                string,
                Array<{ date: string; status: string }>
            > = {}

            // Process journal entries
            for (const page of journalPages) {
                const content = await getPageContent(page.name)
                if (!content) continue

                const dateObj = journalDayToDate(page.journalDay)
                if (!dateObj) {
                    console.warn(`Skipping journal page with invalid journalDay: ${page.journalDay}`)
                    continue
                }
                const date = dateObj.toISOString().split('T')[0]
                topicsByDate[date] = new Set()

                const processBlocks = (blocks: any[]) => {
                    for (const block of blocks) {
                        if (!block.content) continue

                        // Extract page references (topics)
                        if (includeTopics) {
                            const matches = [...block.content.matchAll(PAGE_LINK_REGEX)]
                            for (const match of matches) {
                                const topic = match[1].trim()
                                topicFrequency[topic] = (topicFrequency[topic] || 0) + 1
                                topicsByDate[date].add(topic)
                            }
                        }

                        // Look for mood indicators
                        if (includeMood) {
                            const moodIndicators = [
                                'mood:',
                                'feeling:',
                                '😊',
                                '😔',
                                '😠',
                                '😌',
                                'happy',
                                'sad',
                                'angry',
                                'excited',
                                'tired',
                                'anxious',
                            ]

                            for (const indicator of moodIndicators) {
                                if (
                                    block.content.toLowerCase().includes(indicator.toLowerCase())
                                ) {
                                    moodPatterns.push({
                                        date,
                                        mood: block.content,
                                        context: block.content,
                                    })
                                    break
                                }
                            }
                        }

                        // Track habits and tasks
                        if (
                            block.content.includes('- [ ]') ||
                            block.content.includes('- [x]')
                        ) {
                            const habit = block.content.replace(/- \[[ x]\] /, '').trim()
                            if (!habitPatterns[habit]) {
                                habitPatterns[habit] = []
                            }
                            habitPatterns[habit].push({
                                date,
                                done: block.content.includes('- [x]'),
                            })
                        }

                        // Look for project status updates
                        if (
                            block.content.includes('#project') ||
                            block.content.includes('#status')
                        ) {
                            const projectMatch = block.content.match(/#project\/([^\s]+)/)
                            if (projectMatch) {
                                const project = projectMatch[1]
                                if (!projectProgress[project]) {
                                    projectProgress[project] = []
                                }
                                projectProgress[project].push({
                                    date,
                                    status: block.content,
                                })
                            }
                        }

                        if (block.children && block.children.length > 0) {
                            processBlocks(block.children)
                        }
                    }
                }

                processBlocks(content)
            }

            // Generate insights report
            let report = '# Journal Analysis Insights\n\n'
            report += `Analysis period: ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}\n\n`

            // Topic Trends
            if (includeTopics && Object.keys(topicFrequency).length > 0) {
                report += '## Topic Trends\n\n'

                // Most discussed topics
                const sortedTopics = Object.entries(topicFrequency)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)

                report += '### Most Discussed Topics\n'
                sortedTopics.forEach(([topic, count]) => {
                    report += `- [[${topic}]] (${count} mentions)\n`
                })
                report += '\n'

                // Topic clusters over time
                report += '### Topic Evolution\n'
                const weeks: Record<string, Set<string>> = {}
                Object.entries(topicsByDate).forEach(([date, topics]) => {
                    const week = new Date(date).toISOString().slice(0, 7)
                    if (!weeks[week]) weeks[week] = new Set()
                    topics.forEach((topic) => weeks[week].add(topic))
                })

                Object.entries(weeks).forEach(([week, topics]) => {
                    if (topics.size > 0) {
                        report += `\n#### ${week}\n`
                        Array.from(topics).forEach((topic) => {
                            report += `- [[${topic}]]\n`
                        })
                    }
                })
                report += '\n'
            }

            // Mood Analysis
            if (includeMood && moodPatterns.length > 0) {
                report += '## Mood Patterns\n\n'

                // Group moods by week
                const moodsByWeek: Record<
                    string,
                    Array<{ mood: string; context: string }>
                > = {}
                moodPatterns.forEach(({date, mood, context}) => {
                    const week = new Date(date).toISOString().slice(0, 7)
                    if (!moodsByWeek[week]) moodsByWeek[week] = []
                    moodsByWeek[week].push({mood, context})
                })

                Object.entries(moodsByWeek).forEach(([week, moods]) => {
                    report += `### Week of ${week}\n`
                    moods.forEach(({mood, context}) => {
                        report += `- ${context}\n`
                    })
                    report += '\n'
                })
            }

            // Habit Analysis
            if (Object.keys(habitPatterns).length > 0) {
                report += '## Habit Tracking\n\n'

                Object.entries(habitPatterns).forEach(([habit, entries]) => {
                    const total = entries.length
                    const completed = entries.filter((e) => e.done).length
                    const completionRate = ((completed / total) * 100).toFixed(1)

                    report += `### ${habit}\n`
                    report += `- Completion rate: ${completionRate}% (${completed}/${total})\n`

                    // Show streak information
                    let currentStreak = 0
                    let longestStreak = 0
                    let streak = 0

                    entries.forEach(({done}, i) => {
                        if (done) {
                            streak++
                            if (streak > longestStreak) longestStreak = streak
                            if (i === entries.length - 1) currentStreak = streak
                        } else {
                            streak = 0
                        }
                    })

                    if (currentStreak > 0)
                        report += `- Current streak: ${currentStreak} days\n`
                    if (longestStreak > 0)
                        report += `- Longest streak: ${longestStreak} days\n`
                    report += '\n'
                })
            }

            // Project Progress
            if (Object.keys(projectProgress).length > 0) {
                report += '## Project Progress\n\n'

                Object.entries(projectProgress).forEach(([project, updates]) => {
                    report += `### ${project}\n`
                    updates.forEach(({date, status}) => {
                        report += `- ${new Date(date).toLocaleDateString()}: ${status}\n`
                    })
                    report += '\n'
                })
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: report,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error analyzing journal patterns: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Helper function for DataScript queries
async function queryGraph(query: string): Promise<any[]> {
    try {
        const response = await callLogseqApi('logseq.DB.datascriptQuery', [query])
        // Ensure the response is actually an array before returning
        return Array.isArray(response) ? response : []
    } catch (error) {
        console.error('DataScript query error:', error)
        return []
    }
}

// Common query templates
const QUERY_TEMPLATES = {
    recentlyModified: `
		[:find (pull ?p [*])
		 :where
		 [?p :block/updated-at ?t]
		 [(> ?t ?start-time)]]
	`,
    mostReferenced: `
		[:find ?name (count ?r)
		 :where
		 [?b :block/refs ?r]
		 [?r :block/name ?name]]
	`,
    propertyValues: `
		[:find ?page ?value
		 :where
		 [?p :block/properties ?props]
		 [?p :block/name ?page]
		 [(get ?props ?prop) ?value]]
	`,
    blocksByTag: `
		[:find (pull ?b [*])
		 :where
		 [?b :block/refs ?r]
		 [?r :block/name ?tag]]
	`,
    pageConnections: `
		[:find ?from-name ?to-name (count ?b)
		 :where
		 [?b :block/refs ?to]
		 [?b :block/page ?from]
		 [?from :block/name ?from-name]
		 [?to :block/name ?to-name]
		 [(not= ?from ?to)]]
	`,
    contentClusters: `
		[:find ?name (count ?refs) (pull ?p [:block/properties])
		 :where
		 [?p :block/name ?name]
		 [?b :block/refs ?p]
		 [?b :block/content ?content]]
	`,
    taskProgress: `
		[:find ?page ?content ?state
		 :where
		 [?b :block/content ?content]
		 [?b :block/page ?p]
		 [?p :block/name ?page]
		 [(re-find #"TODO|DOING|DONE|NOW" ?content)]
		 [(re-find #"\\[\\[([^\\]]+)\\]\\]" ?content) ?state]]
	`,
    journalInsights: `
		[:find ?date ?content (count ?refs)
		 :where
		 [?p :block/journal? true]
		 [?p :block/journal-day ?date]
		 [?b :block/page ?p]
		 [?b :block/content ?content]
		 [?b :block/refs ?refs]]
	`,
    conceptEvolution: `
		[:find ?name ?t (count ?refs)
		 :where
		 [?p :block/name ?name]
		 [?b :block/refs ?p]
		 [?b :block/created-at ?t]
		 [(not ?p :block/journal?)]]
	`,
    taskQueryWithTime: `
		[:find ?page-name ?content ?marker ?date
		 :where
		 [?b :block/marker ?marker]
		 [(contains? #{"TODO" "LATER" "NOW" "DOING"} ?marker)] ; Filter by specific task markers
		 [?b :block/content ?content]
		 [?b :block/page ?p]
		 [?p :block/name ?page-name]
		 [?b :block/updated-at ?t] ; Use updated-at for recency
		 [(> ?t ?start-time)] ; Filter by time
		 [?p :block/journal-day ?date] ; Include journal date
		]
	`,
}

server.tool(
    'smartQuery',
    {
        request: z
            .string()
            .describe('Natural language description of what you want to find'),
        includeQuery: z
            .boolean()
            .optional()
            .describe('Include the generated Datalog query in results'),
        advanced: z.boolean().optional().describe('Use advanced analysis features'),
    },
    async ({request, includeQuery = false, advanced = false}) => {
        try {
            let query = ''
            let results: any[] = []
            let explanation = ''
            let insights = ''

            // Enhanced pattern matching with natural language understanding
            const req = request.toLowerCase()

            if (
                req.includes('connect') ||
                req.includes('relationship') ||
                req.includes('between')
            ) {
                query = QUERY_TEMPLATES.pageConnections
                results = await queryGraph(query)
                explanation = 'Analyzing page connections and relationships'

                // Sort by connection strength
                results.sort((a, b) => b[2] - a[2])

                // Generate network insights
                const connections = new Map()
                results.forEach(([from, to, count]) => {
                    if (!connections.has(from)) connections.set(from, new Set())
                    connections.get(from).add(to)
                })

                const hubs = Array.from(connections.entries())
                    .sort((a, b) => b[1].size - a[1].size)
                    .slice(0, 5)

                insights = '\n## Network Insights\n\n'
                insights += 'Central concepts (most connections):\n'
                hubs.forEach(([page, connected]) => {
                    insights += `- [[${page}]] connects to ${connected.size} other pages\n`
                })
            } else if (
                req.includes('cluster') ||
                req.includes('group') ||
                req.includes('similar')
            ) {
                query = QUERY_TEMPLATES.contentClusters
                results = await queryGraph(query)
                explanation = 'Identifying content clusters and related concepts'

                // Group by common properties and reference patterns
                const clusters = new Map()
                results.forEach(([name, refs, props]) => {
                    const key = JSON.stringify(props)
                    if (!clusters.has(key)) clusters.set(key, [])
                    clusters.get(key).push([name, refs])
                })

                insights = '\n## Content Clusters\n\n'
                Array.from(clusters.entries()).forEach(([props, pages], i) => {
                    insights += `### Cluster ${i + 1}\n`
                    insights += `Common properties: ${props}\n`
                    pages.forEach(([name, refs]) => {
                        insights += `- [[${name}]] (${refs} references)\n`
                    })
                    insights += '\n'
                })
            } else if (
                req.includes('task') ||
                req.includes('progress') ||
                req.includes('status')
            ) {
                query = QUERY_TEMPLATES.taskProgress
                results = await queryGraph(query)
                explanation = 'Analyzing task and project progress'

                const tasksByState = new Map()
                if (Array.isArray(results)) {
                    results.forEach(([page, content, state]) => {
                        if (!tasksByState.has(state)) tasksByState.set(state, [])
                        tasksByState.get(state).push([page, content])
                    })
                }

                insights = '\n## Task Analysis\n\n'
                for (const [state, tasks] of tasksByState) {
                    insights += `### ${state}\n`
                    tasks.forEach(([page, content]) => {
                        insights += `- ${content} (in [[${page}]])\n`
                    })
                    insights += '\n'
                }
            } else if (
                req.includes('evolution') ||
                req.includes('over time') ||
                req.includes('trend')
            ) {
                query = QUERY_TEMPLATES.conceptEvolution
                results = await queryGraph(query)
                explanation = 'Analyzing concept evolution over time'

                // Group by time periods
                const timelineMap = new Map()
                results.forEach(([name, timestamp, refs]) => {
                    const date = new Date(timestamp).toISOString().slice(0, 7) // Group by month
                    if (!timelineMap.has(date)) timelineMap.set(date, [])
                    timelineMap.get(date).push([name, refs])
                })

                const timeline = Array.from(timelineMap.entries()).sort()

                insights = '\n## Concept Timeline\n\n'
                timeline.forEach(([date, concepts]) => {
                    insights += `### ${date}\n`
                    concepts.sort((a, b) => b[1] - a[1]) // Sort by reference count
                    concepts.forEach(([name, refs]) => {
                        insights += `- [[${name}]] (${refs} references)\n`
                    })
                    insights += '\n'
                })
            } else if (
                (req.includes('task') ||
                    req.includes('todo') ||
                    req.includes('later') ||
                    req.includes('now')) &&
                req.match(/(\d+)\s+days?/)
            ) {
                const daysMatch = req.match(/(\d+)\s+days?/)
                const daysAgo = daysMatch ? parseInt(daysMatch[1], 10) : 14 // Default to 14 days
                const startTime = Date.now() - daysAgo * 24 * 60 * 60 * 1000

                query = QUERY_TEMPLATES.taskQueryWithTime.replace(
                    '?start-time',
                    startTime.toString()
                )
                results = await queryGraph(query)
                explanation = `Finding TODO, LATER, or NOW tasks updated in the last ${daysAgo} days`

                const tasksByMarker = new Map()
                if (Array.isArray(results)) {
                    results.forEach(([page, content, marker, date]) => {
                        const formattedDate = date
                            ? formatJournalDate(new Date(date))
                            : page // Fallback to page name if date is missing
                        if (!tasksByMarker.has(marker)) tasksByMarker.set(marker, [])
                        tasksByMarker.get(marker).push({page: formattedDate, content})
                    })
                }

                insights = '\n## Tasks by Status\n\n'
                for (const [marker, tasks] of tasksByMarker) {
                    insights += `### ${marker}\n`
                    tasks.forEach(({page, content}) => {
                        insights += `- ${content} (from [[${page}]])\n`
                    })
                    insights += '\n'
                }
            } else {
                // Fall back to basic queries
                if (req.includes('recent') || req.includes('modified')) {
                    const daysAgo = 7
                    const startTime = Date.now() - daysAgo * 24 * 60 * 60 * 1000
                    query = QUERY_TEMPLATES.recentlyModified
                    results = await queryGraph(
                        query.replace('?start-time', startTime.toString())
                    )
                    explanation = `Finding pages modified in the last ${daysAgo} days`
                } else if (req.includes('reference') || req.includes('linked')) {
                    query = QUERY_TEMPLATES.mostReferenced
                    results = await queryGraph(query)
                    results.sort((a, b) => b[1] - a[1])
                    explanation = 'Finding most referenced pages'
                }
            }

            // Format results with enhanced insights
            let response = `# Query Results\n\n`
            response += `${explanation}\n\n`

            if (results.length === 0) {
                response += 'No results found.\n'
            } else {
                response += '## Results\n\n'
                if (Array.isArray(results)) {
                    results.slice(0, 20).forEach((result) => {
                        if (Array.isArray(result)) {
                            if (result.length === 2 && typeof result[1] === 'number') {
                                response += `- [[${result[0]}]] (${result[1]} references)\n`
                            } else {
                                response += `- ${result.join(' → ')}\n`
                            }
                        } else {
                            response += `- ${JSON.stringify(result)}\n`
                        }
                    })
                } else {
                    response += 'Error: Query did not return an array of results.\n'
                }
            }

            // Add insights if available
            if (insights) {
                response += insights
            }

            if (includeQuery) {
                response += '\n## Generated Query\n\n```datalog\n' + query + '\n```\n'
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: response,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing query: ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'suggestConnections',
    {
        minConfidence: z
            .number()
            .optional()
            .describe('Minimum confidence score for suggestions (0-1, default: 0.6)'),
        maxSuggestions: z
            .number()
            .optional()
            .describe('Maximum number of suggestions to return (default: 10)'),
        focusArea: z
            .string()
            .optional()
            .describe('Optional topic or area to focus suggestions around'),
    },
    async ({minConfidence = 0.6, maxSuggestions = 10, focusArea}) => {
        try {
            const pages = await callLogseqApi('logseq.Editor.getAllPages')

            // Analysis containers
            const pageContent: Record<string, string> = {}
            const pageConnections: Record<string, Set<string>> = {}
            const pageTopics: Record<string, Set<string>> = {}
            const sharedReferences: Record<string, Record<string, number>> = {}

            // First pass: gather content and extract topics
            for (const page of pages) {
                if (!page.name) continue

                const content = await getPageContent(page.name)
                if (!content) continue

                // Process blocks to extract text and topics
                const processBlocks = (blocks: any[]): string => {
                    let text = ''
                    const topics = new Set<string>()

                    for (const block of blocks) {
                        if (!block.content) continue

                        text += block.content + '\n'

                        // Extract topics (tags, links, and key terms)
                        const tags = block.content.match(/#[\w-]+/g) || []
                        const links = [...block.content.matchAll(PAGE_LINK_REGEX)].map(
                            (m) => m[1].trim()
                        )

                        tags.forEach((tag) => topics.add(tag.slice(1))) // Remove # from tags
                        links.forEach((link) => topics.add(link))

                        if (block.children?.length > 0) {
                            text += processBlocks(block.children)
                        }
                    }

                    pageTopics[page.name] = topics
                    return text
                }

                pageContent[page.name] = processBlocks(content)
                pageConnections[page.name] = new Set()
            }

            // Second pass: analyze connections and shared context
            for (const [pageName, content] of Object.entries(pageContent)) {
                // Find direct references
                const links = [...content.matchAll(PAGE_LINK_REGEX)].map((m) =>
                    m[1].trim()
                )
                links.forEach((link) => pageConnections[pageName].add(link))

                // Initialize shared references tracking
                if (!sharedReferences[pageName]) {
                    sharedReferences[pageName] = {}
                }

                // Look for pages with shared topics or similar content
                for (const [otherPage, otherContent] of Object.entries(pageContent)) {
                    if (pageName === otherPage) continue

                    // Count shared topics
                    const sharedTopics = new Set(
                        [...pageTopics[pageName]].filter((topic) =>
                            pageTopics[otherPage].has(topic)
                        )
                    )

                    // Simple similarity score based on shared topics and content overlap
                    const similarityScore =
                        sharedTopics.size * 0.6 + // Weight shared topics more heavily
                        (content.toLowerCase().includes(otherPage.toLowerCase())
                            ? 0.2
                            : 0) +
                        (otherContent.toLowerCase().includes(pageName.toLowerCase())
                            ? 0.2
                            : 0)

                    if (similarityScore > 0) {
                        sharedReferences[pageName][otherPage] = similarityScore
                    }
                }
            }

            // Generate suggestions
            const suggestions: Array<{
                type: string
                pages: string[]
                reason: string
                confidence: number
            }> = []

            // 1. Suggest connections between pages with high similarity but no direct links
            for (const [page1, similarities] of Object.entries(sharedReferences)) {
                const sortedSimilar = Object.entries(similarities)
                    .sort((a, b) => b[1] - a[1])
                    .filter(
                        ([page2, score]) =>
                            score >= minConfidence &&
                            !pageConnections[page1].has(page2) &&
                            !pageConnections[page2].has(page1)
                    )

                for (const [page2, score] of sortedSimilar) {
                    const sharedTopics = [...pageTopics[page1]].filter((topic) =>
                        pageTopics[page2].has(topic)
                    )

                    if (sharedTopics.length > 0) {
                        suggestions.push({
                            type: 'potential_connection',
                            pages: [page1, page2],
                            reason: `Share ${sharedTopics.length} topics: ${sharedTopics
                                .slice(0, 3)
                                .join(', ')}${sharedTopics.length > 3 ? '...' : ''}`,
                            confidence: score,
                        })
                    }
                }
            }

            // 2. Suggest knowledge synthesis opportunities
            const clusters = new Map<string, Set<string>>()
            for (const [page, topics] of Object.entries(pageTopics)) {
                for (const topic of topics) {
                    if (!clusters.has(topic)) {
                        clusters.set(topic, new Set())
                    }
                    clusters.get(topic)!.add(page)
                }
            }

            // Find topics with multiple related pages but no synthesis page
            for (const [topic, relatedPages] of clusters) {
                if (relatedPages.size >= 3 && !pages.some((p) => p.name === topic)) {
                    suggestions.push({
                        type: 'synthesis_opportunity',
                        pages: Array.from(relatedPages),
                        reason: `Multiple pages discussing "${topic}" - consider creating a synthesis page`,
                        confidence: 0.8 + relatedPages.size * 0.05, // Higher confidence with more related pages
                    })
                }
            }

            // 3. Suggest exploration paths based on current interests
            const recentPages = pages
                .filter((p: any) => p.updatedAt)
                .sort(
                    (a: any, b: any) =>
                        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                )
                .slice(0, 10)
                .map((p: any) => p.name)

            const recentTopics = new Set<string>()
            recentPages.forEach((page) => {
                if (pageTopics[page]) {
                    pageTopics[page].forEach((topic) => recentTopics.add(topic))
                }
            })

            // Find pages related to recent topics but not recently viewed
            const potentialInterests = new Set<string>()
            recentTopics.forEach((topic) => {
                if (clusters.has(topic)) {
                    clusters.get(topic)!.forEach((page) => {
                        if (!recentPages.includes(page)) {
                            potentialInterests.add(page)
                        }
                    })
                }
            })

            Array.from(potentialInterests).forEach((page) => {
                const relevantTopics = [...pageTopics[page]].filter((t) =>
                    recentTopics.has(t)
                )
                if (relevantTopics.length >= 2) {
                    suggestions.push({
                        type: 'exploration_suggestion',
                        pages: [page],
                        reason: `Related to your recent interests: ${relevantTopics
                            .slice(0, 3)
                            .join(', ')}`,
                        confidence: 0.6 + relevantTopics.length * 0.1,
                    })
                }
            })

            // Filter and sort suggestions
            const filteredSuggestions = suggestions
                .filter((s) => s.confidence >= minConfidence)
                .sort((a, b) => b.confidence - a.confidence)

            // If focusArea is provided, prioritize suggestions related to that topic
            if (focusArea) {
                filteredSuggestions.sort((a, b) => {
                    const aRelevance = a.pages.some(
                        (p) =>
                            pageTopics[p]?.has(focusArea) ||
                            p.toLowerCase().includes(focusArea.toLowerCase())
                    )
                        ? 1
                        : 0
                    const bRelevance = b.pages.some(
                        (p) =>
                            pageTopics[p]?.has(focusArea) ||
                            p.toLowerCase().includes(focusArea.toLowerCase())
                    )
                        ? 1
                        : 0
                    return bRelevance - aRelevance || b.confidence - a.confidence
                })
            }

            // Generate the report
            let report = '# AI-Enhanced Connection Suggestions\n\n'

            if (focusArea) {
                report += `Focusing on topics related to: ${focusArea}\n\n`
            }

            // Group suggestions by type
            const groupedSuggestions = filteredSuggestions
                .slice(0, maxSuggestions)
                .reduce((groups: Record<string, typeof suggestions>, suggestion) => {
                    if (!groups[suggestion.type]) {
                        groups[suggestion.type] = []
                    }
                    groups[suggestion.type].push(suggestion)
                    return groups
                }, {})

            // Potential Connections
            if (groupedSuggestions.potential_connection?.length > 0) {
                report += '## Suggested Connections\n\n'
                groupedSuggestions.potential_connection.forEach(
                    ({pages, reason, confidence}) => {
                        report += `### ${pages[0]} ↔ ${pages[1]}\n`
                        report += `- **Why**: ${reason}\n`
                        report += `- **Confidence**: ${(confidence * 100).toFixed(1)}%\n\n`
                    }
                )
            }

            // Synthesis Opportunities
            if (groupedSuggestions.synthesis_opportunity?.length > 0) {
                report += '## Knowledge Synthesis Opportunities\n\n'
                groupedSuggestions.synthesis_opportunity.forEach(
                    ({pages, reason, confidence}) => {
                        report += `### Synthesis Suggestion\n`
                        report += `- **Topic**: ${reason.split('"')[1]}\n`
                        report += `- **Related Pages**:\n`
                        pages.forEach((page) => (report += `  - [[${page}]]\n`))
                        report += `- **Confidence**: ${(confidence * 100).toFixed(1)}%\n\n`
                    }
                )
            }

            // Exploration Suggestions
            if (groupedSuggestions.exploration_suggestion?.length > 0) {
                report += '## Suggested Explorations\n\n'
                groupedSuggestions.exploration_suggestion.forEach(
                    ({pages, reason, confidence}) => {
                        report += `### [[${pages[0]}]]\n`
                        report += `- **Why**: ${reason}\n`
                        report += `- **Confidence**: ${(confidence * 100).toFixed(1)}%\n\n`
                    }
                )
            }

            // Add summary statistics
            report += '## Analysis Summary\n\n'
            report += `- Total pages analyzed: ${Object.keys(pageContent).length}\n`
            report += `- Unique topics found: ${
                new Set(Object.values(pageTopics).flatMap((t) => Array.from(t))).size
            }\n`
            report += `- Suggestions generated: ${filteredSuggestions.length}\n`

            return {
                content: [
                    {
                        type: 'text',
                        text: report,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error generating suggestions: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Parse Markdown content into a structured blocks tree
function parseMarkdownToBlocksTree(content: string): any[] {
    // Split content into lines
    const lines = content.split('\n')

    // Create a tree structure
    const root: any[] = []
    const stack: { blocks: any[]; level: number }[] = [
        {blocks: root, level: -1},
    ]

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) continue

        // Count indentation level (number of leading spaces)
        const match = line.match(/^(\s*)-\s/)

        // If not a list item format (no bullet), we can just add it as-is
        if (!match) {
            stack[0].blocks.push({
                content: line.trim(),
                children: [],
            })
            continue
        }

        const indent = match[1].length
        const currentLevel = Math.floor(indent / 2) // Assume 2 spaces per indent level
        const content = line.replace(/^\s*-\s/, '').trim()

        // Create new block
        const newBlock = {
            content,
            children: [],
        }

        // Find the appropriate parent in the stack
        while (stack.length > 1 && stack[stack.length - 1].level >= currentLevel) {
            stack.pop()
        }

        // Add the block to its parent
        stack[stack.length - 1].blocks.push(newBlock)

        // Add this block to the stack
        stack.push({
            blocks: newBlock.children,
            level: currentLevel,
        })
    }

    return root
}

// Helper function to insert a block tree into Logseq
async function insertBlocksTree(
    parentUuid: string,
    blocks: any[]
): Promise<void> {
    if (!blocks || blocks.length === 0) return

    for (const block of blocks) {
        // Insert the current block
        const response = await callLogseqApi('logseq.Editor.insertBlock', [
            parentUuid,
            block.content,
            {
                before: false, // After parent block
            },
        ])

        if (response.uuid && block.children && block.children.length > 0) {
            // Insert children recursively
            await insertBlocksTree(response.uuid, block.children)
        }
    }
}

// Helper function to insert block content while properly handling Logseq's bullet format
async function insertFormattedContent(
    pageName: string,
    content: string
): Promise<string> {
    try {
        // 1. Create a top-level block as "container"
        const pageResult = await callLogseqApi('logseq.Editor.getPage', [pageName])
        if (!pageResult) {
            throw new Error(`Page ${pageName} not found`)
        }

        // Get the page blocks to check if it has content
        const pageBlocks = await callLogseqApi('logseq.Editor.getPageBlocksTree', [
            pageName,
        ])

        // 2. Clean up content - remove any explicit bullets at the start of lines
        // This is critical - we need to remove the bullet markers since Logseq adds them automatically
        const cleanContent = content
            .split('\n')
            .map((line) => {
                // Remove bullet markers while preserving indentation
                return line.replace(/^(\s*)-\s+/, '$1')
            })
            .join('\n')

        // 3. Create a properly nested block structure from the hierarchical content
        const blocks = parseHierarchicalContent(cleanContent)

        // 4. Insert the first block at the page level (top level)
        let insertedBlockUuid = ''

        // If the content is already structured with indentation, use our special handling
        if (blocks.length > 0) {
            // Insert the first block
            const firstBlock = await callLogseqApi(
                'logseq.Editor.appendBlockInPage',
                [pageName, blocks[0].content]
            )

            if (!firstBlock || !firstBlock.uuid) {
                throw new Error('Failed to insert initial block')
            }

            insertedBlockUuid = firstBlock.uuid

            // Insert child blocks recursively
            if (blocks[0].children && blocks[0].children.length > 0) {
                await insertChildBlocks(insertedBlockUuid, blocks[0].children)
            }

            // Insert any remaining top-level blocks
            for (let i = 1; i < blocks.length; i++) {
                const blockResponse = await callLogseqApi(
                    'logseq.Editor.appendBlockInPage',
                    [pageName, blocks[i].content]
                )

                if (
                    blockResponse &&
                    blockResponse.uuid &&
                    blocks[i].children &&
                    blocks[i].children.length > 0
                ) {
                    await insertChildBlocks(blockResponse.uuid, blocks[i].children)
                }
            }

            return insertedBlockUuid
        } else {
            // Fallback for simple content - insert as a single block
            const response = await callLogseqApi('logseq.Editor.appendBlockInPage', [
                pageName,
                cleanContent,
            ])

            return response?.uuid || ''
        }
    } catch (error) {
        console.error('Error inserting formatted content:', error)
        throw error
    }
}

// Helper function to insert child blocks recursively
async function insertChildBlocks(
    parentUuid: string,
    blocks: any[]
): Promise<void> {
    for (const block of blocks) {
        const blockResponse = await callLogseqApi('logseq.Editor.insertBlock', [
            parentUuid,
            block.content,
            {sibling: false}, // Insert as child, not sibling
        ])

        if (blockResponse?.uuid && block.children && block.children.length > 0) {
            await insertChildBlocks(blockResponse.uuid, block.children)
        }
    }
}

// Define proper block type at the top of the file
interface Block {
    content: string
    children: Block[]
}

// Parse hierarchical content based on indentation
function parseHierarchicalContent(content: string): Block[] {
    const lines = content.split('\n')
    const result: Block[] = []
    let stack: { block: Block; level: number }[] = []
    let currentLevel = 0

    for (const line of lines) {
        if (!line.trim()) continue

        // Calculate indentation level (number of leading spaces)
        const indentMatch = line.match(/^(\s*)/)
        const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0

        // Create block for this line
        const block: Block = {
            content: line.trim(),
            children: [],
        }

        if (indentLevel === 0) {
            // Top-level block
            result.push(block)
            stack = [{block, level: 0}]
        } else if (indentLevel > currentLevel) {
            // Child of previous block
            if (stack.length > 0) {
                stack[stack.length - 1].block.children.push(block)
                stack.push({block, level: indentLevel})
            }
        } else {
            // Find appropriate parent
            while (stack.length > 1 && stack[stack.length - 1].level >= indentLevel) {
                stack.pop()
            }

            if (stack.length > 0) {
                stack[stack.length - 1].block.children.push(block)
                stack.push({block, level: indentLevel})
            }
        }

        currentLevel = indentLevel
    }

    return result
}

// Recursive function to insert blocks
async function insertBlocksRecursively(
    page: string,
    parentUuid: string | null,
    blocks: Block[]
): Promise<void> {
    for (const block of blocks) {
        const blockUuid = await callLogseqApi('logseq.Editor.insertBlock', [
            page,
            block.content,
            {
                sibling: false,
                before: false,
                isPageBlock: !parentUuid,
                uuid: parentUuid,
            },
        ])

        if (blockUuid && block.children.length > 0) {
            await insertBlocksRecursively(page, blockUuid, block.children)
        }
    }
}

// Fix the unnecessary template literals
function formatBlockContent(content: string): string {
    return content.replace(/^- /gm, '').trim()
}

server.tool(
    'addJournalBlock',
    {
        content: z
            .string()
            .describe('Content to add as a single block to a journal page'),
        date: z
            .string()
            .optional()
            .describe(
                'Optional journal date (e.g., "mar 14th, 2025"). Defaults to today'
            ),
        preserveFormatting: z
            .boolean()
            .optional()
            .describe('Whether to preserve markdown formatting (default: true)'),
    },
    async ({content, date, preserveFormatting = true}) => {
        try {
            // Determine the journal page name (today or specific date)
            const pageName = date || formatJournalDate(new Date())

            // Check if this page exists, create if needed
            let pageExists = false
            try {
                const existingPage = await callLogseqApi('logseq.Editor.getPage', [
                    pageName,
                ])
                pageExists = !!existingPage
            } catch (e) {
                // Page doesn't exist, we'll create it
                console.log(`Journal page ${pageName} doesn't exist yet, creating...`)
            }

            // Create the journal page if it doesn't exist
            if (!pageExists) {
                await callLogseqApi('logseq.Editor.createPage', [
                    pageName,
                    {'journal?': true},
                ])
            }

            // Clean up content
            let cleanContent = content.trim()

            // Remove the title/heading if it's the same as the page name (to avoid duplication)
            const titleRegex = new RegExp(`^#\\s+${pageName}\\s*$`, 'im')
            cleanContent = cleanContent.replace(titleRegex, '').trim()

            if (preserveFormatting) {
                // Get the page's UUID
                const page = await callLogseqApi('logseq.Editor.getPage', [pageName])
                if (!page || !page.uuid) {
                    throw new Error(`Could not get UUID for page ${pageName}`)
                }

                // Add a single top-level block first
                const response = await callLogseqApi(
                    'logseq.Editor.appendBlockInPage',
                    [pageName, 'Journal entry from MCP']
                )

                if (!response || !response.uuid) {
                    throw new Error('Failed to create initial block')
                }

                // Insert the content as a child block to preserve its formatting exactly
                // Use insertBlock instead of appendBlockInPage to maintain hierarchy
                const blockResponse = await callLogseqApi('logseq.Editor.insertBlock', [
                    response.uuid,
                    cleanContent,
                    {properties: {}},
                ])

                // Now remove the placeholder parent block to leave just our content
                await callLogseqApi('logseq.Editor.removeBlock', [response.uuid])

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Added journal entry to "${pageName}" as a properly formatted block.`,
                        },
                    ],
                }
            } else {
                // Simple append as a basic block
                await callLogseqApi('logseq.Editor.appendBlockInPage', [
                    pageName,
                    cleanContent,
                ])

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Added journal entry to "${pageName}" as a basic block.`,
                        },
                    ],
                }
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error adding journal block: ${error.message}`,
                    },
                ],
            }
        }
    }
)

server.tool(
    'addJournalContent',
    {
        content: z
            .string()
            .describe('Content to add to the journal page (preserves formatting)'),
        date: z
            .string()
            .optional()
            .describe(
                'Optional date format (e.g., "mar 14th, 2025"). Defaults to today'
            ),
    },
    async ({content, date}) => {
        try {
            // Determine journal page name
            const pageName = date || formatJournalDate(new Date())

            // Create journal page if it doesn't exist
            let pageExists = false
            try {
                const existingPage = await callLogseqApi('logseq.Editor.getPage', [
                    pageName,
                ])
                pageExists = !!existingPage
            } catch (e) {
                console.log(`Journal page ${pageName} doesn't exist yet, creating...`)
            }

            if (!pageExists) {
                await callLogseqApi('logseq.Editor.createPage', [
                    pageName,
                    {'journal?': true},
                ])
            }

            // Clean up content to handle common issues
            let cleanContent = content.trim()

            // Remove page title/heading if it matches the page name
            const titleRegex = new RegExp(`^#\\s+${pageName}\\s*$`, 'im')
            cleanContent = cleanContent.replace(titleRegex, '').trim()

            // Insert the content with proper formatting
            await insertFormattedContent(pageName, cleanContent)

            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully added formatted content to journal page "${pageName}".`,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error adding journal content: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Add a tool to add formatted content to any note with proper structure preservation
server.tool(
    'addNoteContent',
    {
        pageName: z.string().describe('The name of the page to add content to'),
        content: z
            .string()
            .describe('Content to add to the page, with Markdown formatting'),
        createIfNotExist: z
            .boolean()
            .default(true)
            .describe('Whether to create the page if it does not exist'),
    },
    async ({pageName, content, createIfNotExist}) => {
        try {
            // Check if the page exists
            const page = await callLogseqApi('logseq.Editor.getPage', [pageName])

            if (!page && createIfNotExist) {
                // Create page if it doesn't exist
                await callLogseqApi('logseq.Editor.createPage', [
                    pageName,
                    {},
                    {createFirstBlock: true},
                ])
            } else if (!page) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Page "${pageName}" does not exist and createIfNotExist is false`,
                        },
                    ],
                }
            }

            // Clean up content to make sure it doesn't have bullet points
            const cleanContent = content
                .split('\n')
                .map((line) => line.replace(/^(\s*)-\s+/, '$1'))
                .join('\n')

            // Parse the content into a hierarchical structure
            const blocks = parseHierarchicalContent(cleanContent)

            // Count total blocks for feedback
            const totalBlocks = countBlocks(blocks)

            // Insert the blocks
            if (blocks.length > 0) {
                // Different handling based on content complexity
                if (blocks.length === 1 && blocks[0].children.length === 0) {
                    // Simple content - just append as a single block
                    await callLogseqApi('logseq.Editor.appendBlockInPage', [
                        pageName,
                        blocks[0].content,
                    ])
                } else {
                    // Complex content with hierarchy - use the structured insertion
                    for (const block of blocks) {
                        const firstBlock = await callLogseqApi(
                            'logseq.Editor.appendBlockInPage',
                            [pageName, block.content]
                        )

                        if (block.children.length > 0 && firstBlock && firstBlock.uuid) {
                            // Insert child blocks recursively
                            await insertChildBlocks(firstBlock.uuid, block.children)
                        }
                    }
                }
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Content added to "${pageName}" successfully (${totalBlocks} block${
                            totalBlocks !== 1 ? 's' : ''
                        })`,
                    },
                ],
            }
        } catch (error: any) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error adding content: ${error.message}`,
                    },
                ],
            }
        }
    }
)

// Helper function to count total blocks in a hierarchical structure
function countBlocks(blocks: Block[]): number {
    let count = blocks.length

    for (const block of blocks) {
        count += countBlocks(block.children)
    }

    return count
}

// Add a tool to get a specific block and its children by UUID
server.tool(
    'getBlock',
    {
        blockId: z
            .string()
            .describe(
                'The UUID of the block to fetch (without the double parentheses)'
            ),
        includeChildren: z
            .boolean()
            .default(true)
            .describe('Whether to include children blocks'),
    },
    async ({blockId, includeChildren}) => {
        try {
            // Clean the block ID if it includes parentheses
            const cleanBlockId = blockId.replace(/^\(\(|\)\)$/g, '')

            // Fetch the block using the Logseq API
            const block = await callLogseqApi('logseq.Editor.getBlock', [
                cleanBlockId,
                {includeChildren},
            ])

            if (!block) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Block with ID ${cleanBlockId} not found`,
                        },
                    ],
                }
            }

            // Format the result for display
            const formatBlockContent = (block, level = 0) => {
                const indent = '  '.repeat(level)
                let result = `${indent}- ${block.content}\n`

                if (block.children && block.children.length > 0) {
                    for (const child of block.children) {
                        result += formatBlockContent(child, level + 1)
                    }
                }

                return result
            }

            // Get parent info safely
            let parentInfo = 'None'
            if (block.parent) {
                // Handle different formats of parent reference
                if (typeof block.parent === 'string') {
                    parentInfo = block.parent.substring(0, 8) + '...'
                } else if (block.parent.id && typeof block.parent.id === 'string') {
                    parentInfo = block.parent.id.substring(0, 8) + '...'
                } else if (block.parent.uuid && typeof block.parent.uuid === 'string') {
                    parentInfo = block.parent.uuid.substring(0, 8) + '...'
                } else {
                    parentInfo = 'Unknown format'
                }
            }

            // Get page info safely
            let pageName = 'Unknown page'
            if (block.page) {
                if (typeof block.page === 'string') {
                    pageName = block.page
                } else if (block.page.name && typeof block.page.name === 'string') {
                    pageName = block.page.name
                } else if (
                    block.page.originalName &&
                    typeof block.page.originalName === 'string'
                ) {
                    pageName = block.page.originalName
                }
            }

            const blockWithMeta = {
                ...block,
                _meta: {
                    page: pageName,
                    parentBlock: parentInfo,
                    createdAt: block.createdAt
                        ? new Date(block.createdAt).toLocaleString()
                        : 'Unknown',
                    updatedAt: block.updatedAt
                        ? new Date(block.updatedAt).toLocaleString()
                        : 'Unknown',
                },
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Block ID: ${cleanBlockId}`,
                    },
                    {
                        type: 'text',
                        text: `Page: ${blockWithMeta._meta.page}`,
                    },
                    {
                        type: 'text',
                        text: `Parent Block: ${blockWithMeta._meta.parentBlock}`,
                    },
                    {
                        type: 'text',
                        text: `Created: ${blockWithMeta._meta.createdAt}`,
                    },
                    {
                        type: 'text',
                        text: `Updated: ${blockWithMeta._meta.updatedAt}`,
                    },
                    {
                        type: 'text',
                        text: '---',
                    },
                    {
                        type: 'text',
                        text: includeChildren
                            ? formatBlockContent(block)
                            : `- ${block.content}`,
                    },
                ],
            }
        } catch (error: any) {
            console.error('Error details:', error)
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching block: ${error.message}`,
                    },
                    {
                        type: 'text',
                        text:
                            'Try using the blockId without double parentheses: ' +
                            blockId.replace(/^\(\(|\)\)$/g, ''),
                    },
                ],
            }
        }
    }
)

const transport = new StdioServerTransport()
await server.connect(transport)
