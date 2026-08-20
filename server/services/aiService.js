// services/aiService.js
const axios = require("axios");
const supportToolsController = require("../controllers/supportToolsController");

/**
 * Definition of Indore transit tools in OpenAI function calling format.
 */
const TOOLS = [
    {
        type: "function",
        function: {
            name: "getNearestStops",
            description: "Find Indore public transit stops nearest to a given latitude and longitude coordinate.",
            parameters: {
                type: "object",
                properties: {
                    latitude: {
                        type: "number",
                        description: "Latitude of the location"
                    },
                    longitude: {
                        type: "number",
                        description: "Longitude of the location"
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum number of nearest stops to return (default is 3)"
                    }
                },
                required: ["latitude", "longitude"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "searchStops",
            description: "Search for Indore public transit stops by name or partial name matching.",
            parameters: {
                type: "object",
                properties: {
                    q: {
                        type: "string",
                        description: "The search term for stop names (e.g., 'palasia', 'vijay nagar')"
                    }
                },
                required: ["q"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "getRouteStops",
            description: "Retrieve all stops in sequential order for a specific route ID.",
            parameters: {
                type: "object",
                properties: {
                    routeId: {
                        type: "integer",
                        description: "The numeric ID of the route"
                    }
                },
                required: ["routeId"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "planRoute",
            description: "Plan transit journey to a destination in Indore. Accepts start coordinates (startLat, startLng) or start stop name, plus destination stop name or landmark (endStopName). Returns matching routes and live bus arrival status.",
            parameters: {
                type: "object",
                properties: {
                    startStopName: {
                        type: "string",
                        description: "Name of starting stop (optional if startLat/startLng are provided)"
                    },
                    endStopName: {
                        type: "string",
                        description: "Name of destination stop, area, or landmark (e.g. 'Bhawarkuan', 'Vijay Nagar')"
                    },
                    startLat: {
                        type: "number",
                        description: "Starting latitude (from User's GPS coordinates)"
                    },
                    startLng: {
                        type: "number",
                        description: "Starting longitude (from User's GPS coordinates)"
                    },
                    endLat: {
                        type: "number",
                        description: "Destination latitude (if known)"
                    },
                    endLng: {
                        type: "number",
                        description: "Destination longitude (if known)"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "getLiveBuses",
            description: "Get real-time location details of active buses in Indore, optionally filtered by route ID or stop name.",
            parameters: {
                type: "object",
                properties: {
                    routeId: {
                        type: "integer",
                        description: "Filter active buses by numeric route ID"
                    },
                    stopName: {
                        type: "string",
                        description: "Filter active buses by stop name they serve"
                    }
                }
            }
        }
    }
];

/**
 * Mocks request and response objects to execute the tools locally
 * by invoking controllers directly without actual HTTP loopback.
 */
const mockReqRes = () => {
    let responseData = null;
    let statusCode = 200;
    const res = {
        status: (code) => {
            statusCode = code;
            return res;
        },
        json: (data) => {
            responseData = data;
            return res;
        }
    };
    return {
        res,
        getData: () => ({ statusCode, data: responseData })
    };
};

/**
 * Local executor mapping tool names to controller methods.
 */
const executeTool = async (toolName, args) => {
    const { res, getData } = mockReqRes();
    const req = { query: args };

    try {
        switch (toolName) {
            case "getNearestStops":
                await supportToolsController.getNearestStopsTool(req, res);
                break;
            case "searchStops":
                await supportToolsController.searchStopsTool(req, res);
                break;
            case "getRouteStops":
                await supportToolsController.getRouteStopsTool(req, res);
                break;
            case "planRoute":
                await supportToolsController.planRouteTool(req, res);
                break;
            case "getLiveBuses":
                await supportToolsController.getLiveBusesTool(req, res);
                break;
            default:
                return { success: false, error: `Unknown tool: ${toolName}` };
        }
        return getData().data;
    } catch (err) {
        console.error(`[AI Tool Exec] Error running ${toolName}:`, err.message);
        return { success: false, error: err.message };
    }
};

/**
 * Core chat completion function featuring local tool loop execution.
 * @param {Array} messages - Full conversation context (system, history, new user message)
 */
const CANDIDATE_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.6-27b",
    "groq/compound"
];

const getChatResponse = async (messages) => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY environment variable is not configured.");
    }

    let currentMessages = [...messages];
    let loopCount = 0;
    const maxLoops = 8;

    while (loopCount < maxLoops) {
        console.log(`[Groq AI] Sending chat completion request (loop turn ${loopCount + 1})...`);

        let response = null;
        let lastError = null;

        // Try candidate models in case of model deprecation or 404
        for (const modelName of CANDIDATE_MODELS) {
            try {
                response = await axios.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    {
                        model: modelName,
                        messages: currentMessages,
                        tools: TOOLS,
                        tool_choice: "auto",
                        temperature: 0.15,
                        max_tokens: 400
                    },
                    {
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json"
                        },
                        timeout: 30000
                    }
                );
                if (response && response.data) {
                    console.log(`[Groq AI] Success with model: ${modelName}`);
                    break;
                }
            } catch (err) {
                lastError = err;
                const status = err.response ? err.response.status : null;
                console.warn(`[Groq AI] Model ${modelName} call failed (${status || err.message}). Trying next candidate...`);
                if (status === 401) {
                    throw err;
                }
                if (status === 429) {
                    await new Promise(r => setTimeout(r, 600));
                }
            }
        }

        if (!response || !response.data) {
            throw lastError || new Error("Failed to get response from Groq API candidates.");
        }

        const choice = response.data.choices[0];
        if (!choice || !choice.message) {
            throw new Error("Invalid response received from Groq API.");
        }

        const assistantMessage = choice.message;
        currentMessages.push(assistantMessage);

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            console.log(`[Groq AI] Tool execution requested:`, JSON.stringify(assistantMessage.tool_calls));

            for (const toolCall of assistantMessage.tool_calls) {
                const toolName = toolCall.function.name;

                let toolArgs = {};
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments);
                } catch (parseErr) {
                    console.error(`[Groq AI] JSON parse error for tool ${toolName}:`, parseErr.message);
                }

                const toolResult = await executeTool(toolName, toolArgs);

                currentMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: JSON.stringify(toolResult)
                });
            }
            loopCount++;
        } else {
            // Final response text has been returned by model.
            return {
                text: assistantMessage.content || "",
                newMessages: currentMessages.slice(messages.length)
            };
        }
    }

    throw new Error("Max tool call loop execution reached without resolving final response.");
};

module.exports = {
    getChatResponse
};
