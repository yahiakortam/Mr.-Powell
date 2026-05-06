require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;

// Exit early if the bot token is missing
if (!process.env.TOKEN) {
  console.error('ERROR: TOKEN environment variable is missing. The bot cannot start.');
  process.exit(1);
}

// ─── Client Setup ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Required for the guildMemberAdd event
  ],
});

// ─── Slash Command Definitions ────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('findthebell')
    .setDescription('Mr. Powell hid the bell. Find it before class starts.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('discipline')
    .setDescription('Mr. Powell disciplines a student.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The student to discipline')
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Mr. Powell welcomes the class to Made New.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription("Check a student's music class level.")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The student to check (defaults to you)')
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('banaga')
    .setDescription('...')
    .toJSON(),
];

// ─── Ready Event ──────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Registering slash commands globally...');

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log('Slash commands registered. Class is now in session.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

// ─── New Member Welcome ───────────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  if (!WELCOME_CHANNEL_ID) {
    console.error('WELCOME_CHANNEL_ID is missing from .env. Cannot send welcome message.');
    return;
  }

  const welcomeMessages = [
    `Welcome ${member}. I'm Mr. Powell. I'll be taking attendance, keeping the instruments safe, and making sure this server doesn't fall apart.`,
    `${member} has entered the music room. I'm Mr. Powell, and I'll be here to guide you through whatever this server turns into.`,
    `Welcome ${member}. I'm Mr. Powell. Find a seat, don't touch the guitar, and try not to get written on the board.`,
    `${member} joined. I'm Mr. Powell, your official Made New music teacher. I'll be watching the class closely.`,
    `Welcome to Made New, ${member}. I'm Mr. Powell. My job is to keep order, run the bell game, and maintain what little control this class has left.`,
    `Everyone welcome ${member}. I'm Mr. Powell, and I'll be helping keep this server organized, disciplined, and barely under control.`,
    `${member} has been added to attendance. I'm Mr. Powell. Please keep your hands to yourself and do not abuse the tambourine.`,
    `Welcome ${member}. I'm Mr. Powell. I'll help you find your way around, but I cannot help if you choose to enter banaga.`,
    `${member} just joined the class. I'm Mr. Powell, and I'll be making sure nobody ruins music time.`,
    `Welcome ${member}. I'm Mr. Powell. This server is now slightly more crowded and probably less manageable.`,
  ];

  try {
    const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      console.error(`Welcome channel (ID: ${WELCOME_CHANNEL_ID}) was not found or is not a text channel.`);
      return;
    }

    const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
    await channel.send(randomMessage);
  } catch (error) {
    console.error('Failed to send welcome message:', error);
  }
});

// ─── Interaction Router ───────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  // Route button clicks to the bell game handler
  if (interaction.isButton()) {
    await handleBellButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'findthebell':
      await handleFindTheBell(interaction);
      break;
    case 'discipline':
      await handleDiscipline(interaction);
      break;
    case 'welcome':
      await handleWelcome(interaction);
      break;
    case 'level':
      await handleLevel(interaction);
      break;
    case 'banaga':
      await handleBanaga(interaction);
      break;
  }
});

// ─── Command Handlers ─────────────────────────────────────────────────────────

// /findthebell — Guessing game with four location buttons
async function handleFindTheBell(interaction) {
  const locations = [
    { label: 'Under the Piano',        id: 'under_piano'   },
    { label: 'Inside the Recorder Bin', id: 'recorder_bin'  },
    { label: 'Behind the Drum',        id: 'behind_drum'   },
    { label: "On Mr. Powell's Desk",   id: 'desk'          },
  ];

  // Pick a random winning location for this round
  const correctIndex = Math.floor(Math.random() * locations.length);
  const correctId = locations[correctIndex].id;

  // Each button's custom ID encodes: the location, the caller's user ID, and the correct answer
  // Format: bell__{locationId}__{userId}__{correctId}
  const buttons = locations.map(loc =>
    new ButtonBuilder()
      .setCustomId(`bell__${loc.id}__${interaction.user.id}__${correctId}`)
      .setLabel(loc.label)
      .setStyle(ButtonStyle.Primary)
  );

  const row = new ActionRowBuilder().addComponents(buttons);

  await interaction.reply({
    content: 'Mr. Powell hid the bell somewhere in the music room. Find it before class starts.',
    components: [row],
  });
}

// Button click handler — only called when a /findthebell button is clicked
async function handleBellButton(interaction) {
  // Custom ID format: bell__{choiceId}__{userId}__{correctId}
  const parts = interaction.customId.split('__');

  if (parts[0] !== 'bell' || parts.length !== 4) return;

  const [, choiceId, originalUserId, correctId] = parts;

  // Reject clicks from anyone other than the user who ran the command
  if (interaction.user.id !== originalUserId) {
    await interaction.reply({
      content: 'Mr. Powell says this is not your game to play.',
      ephemeral: true,
    });
    return;
  }

  // Rebuild all buttons in a disabled state so the game is locked after one guess
  const disabledButtons = interaction.message.components[0].components.map(button =>
    new ButtonBuilder()
      .setCustomId(button.customId)
      .setLabel(button.label)
      .setStyle(button.style)
      .setDisabled(true)
  );

  const disabledRow = new ActionRowBuilder().addComponents(disabledButtons);

  const resultMessage = choiceId === correctId
    ? 'You found the bell. Mr. Powell allows class to continue.'
    : 'Wrong. Mr. Powell is disappointed and the whole class loses 2 minutes of recess.';

  await interaction.update({
    content: resultMessage,
    components: [disabledRow],
  });
}

// /discipline — Calls out a user with a random message
async function handleDiscipline(interaction) {
  const targetUser = interaction.options.getUser('user');

  const messages = [
    `${targetUser} has been moved to the front row.`,
    `Mr. Powell wrote ${targetUser}'s name on the board.`,
    `${targetUser} has lost instrument privileges.`,
    `Mr. Powell is silently waiting for ${targetUser} to stop talking.`,
    `${targetUser} has been separated from the group.`,
    `${targetUser} is no longer trusted with the tambourine.`,
    `${targetUser} has been caught talking during music time.`,
    `${targetUser} must now sit where Mr. Powell can see them.`,
  ];

  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  await interaction.reply(randomMessage);
}

// /welcome — Posts the official class welcome message
async function handleWelcome(interaction) {
  await interaction.reply(
    "Welcome to Made New. Mr. Powell has taken attendance. Keep your hands to yourself, don't touch the instruments without permission, and join VC when instructed."
  );
}

// /level — Gives a user a random music-class level
async function handleLevel(interaction) {
  // Default to whoever ran the command if no user is specified
  const targetUser = interaction.options.getUser('user') || interaction.user;

  // Levels are random for now.
  // To add real XP tracking later, replace the random pick below with a
  // database lookup keyed on targetUser.id and calculate the level from stored XP.
  const levels = [
    { number: 1,  title: 'Sitting on the Carpet'         },
    { number: 2,  title: 'Reluctant Participant'          },
    { number: 3,  title: 'Triangle Holder'                },
    { number: 4,  title: 'Drum Circle Member'             },
    { number: 5,  title: 'Bell Finder'                    },
    { number: 6,  title: 'Front Row Survivor'             },
    { number: 7,  title: 'Trusted With the Instruments'   },
    { number: 8,  title: "Teacher's Favorite"             },
    { number: 9,  title: 'Music Room Legend'              },
    { number: 10, title: "Mr. Powell's Successor"         },
  ];

  const randomLevel = levels[Math.floor(Math.random() * levels.length)];

  await interaction.reply(
    `${targetUser} is currently **Level ${randomLevel.number}: ${randomLevel.title}**.`
  );
}

// /banaga — Responds with a random banaga message
async function handleBanaga(interaction) {
  const messages = [
    'Mr. Powell heard banaga and stopped the entire lesson.',
    'Banaga has been added to the lesson plan.',
    'Mr. Powell does not know what banaga means, but he is concerned.',
    'The class said banaga too many times. Everyone lost music privileges.',
    'Banaga detected. Recorder test postponed.',
    'Someone said banaga and now Mr. Powell is standing silently at the front of the room.',
    'Banaga has been reported to the principal.',
  ];

  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  await interaction.reply(randomMessage);
}

// ─── Express Web Server ───────────────────────────────────────────────────────

// Render requires a web service to bind to a port.
// This Express server satisfies that requirement and provides a health check URL
// you can ping with UptimeRobot or cron-job.org to keep the free instance awake.
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('Mr. Powell is awake.');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}.`);
});

// ─── Login ────────────────────────────────────────────────────────────────────

console.log('Attempting Discord login...');

client.login(TOKEN).catch(error => {
  console.error('Failed to log into Discord:', error);
  process.exit(1);
});
