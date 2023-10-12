import { userCrud } from "./userCRUD"

async function main() {
    var crud = new userCrud()

    crud.getComments()
}

main()

