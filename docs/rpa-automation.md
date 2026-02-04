# RPA Automation

DolfPower includes a powerful **Remote Process Automation (RPA)** engine that allows for complex multi-step browser tasks without writing code.

## Action Types

The RPA engine supports a wide range of humanized actions:
- **Navigation**: Move to specific URLs.
- **Interaction**: Click, Type, Hover, Select, and Key Presses.
- **Humanized Movement**: Mouse movements follow Bezier curves with randomized speed to bypass bot detection.
- **Humanized Typing**: Simulation of real typing with varying delays and occasional "typo-fix" behavior.
- **Wait & Conditions**: Fixed delays or waiting for specific elements/conditions.
- **Screenshots**: Capture page state for logging or analysis.
- **Variable Management**: Store and reuse values across steps.

## Script Generation

You can create RPA scripts in three ways:
1. **Manual Builder**: Add and configure actions via the UI.
2. **Jarvis Generation**: Describe what you want to do in plain English, and Jarvis generates the JSON script.
3. **Recording**: Use the built-in recorder to capture your actions and convert them into an RPA scenario.

## Humanization Engine

Every automated action is passed through our humanization layer:
- **Bezier Curves**: No straight lines; movements look like they come from a real mouse.
- **Jitter**: Subtle randomized movements during wait times.
- **Focus Simulation**: Proper focusing and clicking on interactive elements.

## Task Scheduling

- **Bulk Execution**: Run a scenario across dozens of profiles simultaneously.
- **Scheduling**: Set a specific time for a task to start.
- **Periodic Tasks**: Repeat scenarios every N minutes or hours.
- **Cron Support**: Use standard Cron expressions for complex scheduling (e.g., "Run every Monday at 9:00 AM").
