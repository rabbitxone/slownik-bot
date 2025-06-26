const { REST, Routes } = require('discord.js');
const { clientId, token } = require('./config.json');

const commands = [
    {
        name: 'slowo',
        description: 'Wyświetla definicję wybranego wyrazu ze słownika języka polskiego',
        options: [
            {
                name: 'slowo',
                type: 3, // string
                description: 'Słowo, którego definicję chcesz zobaczyć',
                required: true,
                autocomplete: true
            },
            {
                name: 'shhh',
                type: 3, // string
                description: 'Czy odpowiedź ma zostać wysłana tylko do Ciebie?',
                required: false,
                choices: [
                    {
                        name: 'Tak, tylko ja chcę widzieć odpowiedź',
                        value: 'true'
                    },
                    {
                        name: 'Nie, wyślij odpowiedź na kanał',
                        value: 'false'
                    }
                ]
            }
        ]
    },
    {
        name: 'synonim',
        description: 'Wyświetla synonimy wybranego wyrazu',
        options: [
            {
                name: 'slowo',
                type: 3, // string
                description: 'Słowo, którego synonimy chcesz zobaczyć',
                required: true,
                autocomplete: true
            },
            {
                name: 'shhh',
                type: 3, // string
                description: 'Czy odpowiedź ma zostać wysłana tylko do Ciebie?',
                required: false,
                choices: [
                    {
                        name: 'Tak, tylko ja chcę widzieć odpowiedź',
                        value: 'true'
                    },
                    {
                        name: 'Nie, wyślij odpowiedź na kanał',
                        value: 'false'
                    }
                ]
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {

    try {
        console.log('Registering app commands...');
        const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log(`Successfully registered ${data.length} application commands.`);
    } catch (e) {
        console.error('Error registering application commands:', e);
    }

})();