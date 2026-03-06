import axios from "axios"

export const getRealtime = async () => {
  const res = await axios.get("http://localhost:3000/api/realtime")
  return res.data
}